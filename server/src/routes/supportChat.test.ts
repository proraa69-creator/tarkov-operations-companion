import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { SUPPORT_CHAT_LIMITS, SupportChatStore } from '../services/supportChatStore.js'
import { SUPPORT_CHAT_RATE_LIMITS } from './supportChat.js'
import { cleanSupportText } from '../../../src/shared/supportChat.js'

/** «Чат с поддержкой» (owner, 13.10.2026: «сделай обратную связь в приложении, чат с пользователем»). */
const password = 'correct horse battery'

interface Message { id: number; author: 'user' | 'owner'; text: string; createdAt: string; read: boolean }
interface Thread { accountId: string; email: string; nickname?: string; nicknames: Record<string, string>; lastMessage: Message; lastAt: string; unread: number }

async function setup(limits?: { perAccount?: number; perIp?: number }) {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  // Payments on the same database: the admin panel (and its audit log) exists.
  const payments = new PaymentStore(db, undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, supportChatLimits: limits, guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let json: unknown
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: response.status, json: json as T, headers: response.headers }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  const register = async (email: string) => (await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password })).json.token
  const idOf = (email: string) => accounts.accountByEmail(email)!.id
  return { db, accounts, call, login, register, idOf, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const BELL = String.fromCharCode(7)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e)

test('support chat text: line breaks stay, control characters and direction overrides go, at most one empty line', () => {
  assert.equal(cleanSupportText(`  Привет${BELL}\r\nмир\t!  `), 'Привет\nмир !')
  assert.equal(cleanSupportText(`a${RIGHT_TO_LEFT_OVERRIDE}b`), 'ab')
  assert.equal(cleanSupportText('строка 1   \n\n\n\n  строка 2'), 'строка 1\n\n  строка 2')
  assert.equal(cleanSupportText(' \r\n\t '), '')
  assert.equal(cleanSupportText('Карта 🗺️ не грузится'), 'Карта 🗺️ не грузится')
})

test('support chat: a player writes, the owner reads and answers; unread marks on both sides; the answer is in the audit log', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    const playerId = t.idOf('player@example.com')
    t.accounts.setNicknames(playerId, { nickname: 'Shturman_77' })

    assert.deepEqual((await t.call('GET', '/me/support/messages', player)).json, { messages: [], unread: 0 })
    const sent = await t.call<{ message: Message }>('POST', '/me/support/messages', player, { text: 'Здравствуйте!\nНе открывается карта Таможни.' })
    assert.equal(sent.status, 201, JSON.stringify(sent.json))
    assert.equal(sent.headers.get('cache-control'), 'no-store')
    assert.deepEqual([sent.json.message.author, sent.json.message.text, sent.json.message.read], ['user', 'Здравствуйте!\nНе открывается карта Таможни.', false])

    type Threads = { threads: Thread[]; total: number; unread: number }
    const listed = await t.call<Threads>('GET', '/accounts/me/admin/support/threads', owner)
    assert.equal(listed.status, 200)
    assert.equal(listed.json.total, 1)
    assert.equal(listed.json.unread, 1)
    const [thread] = listed.json.threads
    assert.deepEqual([thread!.accountId, thread!.email, thread!.nickname, thread!.nicknames.pvp, thread!.unread, thread!.lastMessage.id, thread!.lastAt], [playerId, 'player@example.com', 'Shturman_77', 'Shturman_77', 1, sent.json.message.id, sent.json.message.createdAt])

    const opened = await t.call<{ account: { id: string; email: string; nickname?: string }; messages: Message[] }>('GET', `/accounts/me/admin/support/threads/${playerId}`, owner)
    assert.deepEqual(opened.json.account, { id: playerId, email: 'player@example.com', nickname: 'Shturman_77', nicknames: { pvp: 'Shturman_77', pve: 'Shturman_77', seasonal: 'Shturman_77' } })
    assert.deepEqual(opened.json.messages.map((message) => message.text), ['Здравствуйте!\nНе открывается карта Таможни.'])

    // The owner has seen it: the conversation leaves the unread ones, the player sees his message as read.
    assert.equal((await t.call('POST', `/accounts/me/admin/support/threads/${playerId}/read`, owner)).status, 204)
    assert.equal((await t.call<Threads>('GET', '/accounts/me/admin/support/threads', owner)).json.unread, 0)
    assert.equal((await t.call<{ messages: Message[] }>('GET', '/me/support/messages', player)).json.messages[0]!.read, true)

    const answer = await t.call<{ message: Message }>('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, owner, { text: 'Добрый день! Уже чиним.' })
    assert.equal(answer.status, 201, JSON.stringify(answer.json))
    assert.equal(answer.json.message.author, 'owner')
    const mine = await t.call<{ messages: Message[]; unread: number }>('GET', '/me/support/messages', player)
    assert.equal(mine.json.unread, 1)
    assert.deepEqual(mine.json.messages.map((message) => [message.author, message.read]), [['user', true], ['owner', false]])
    // Only what came after a message.
    const newer = await t.call<{ messages: Message[] }>('GET', `/me/support/messages?after=${sent.json.message.id}`, player)
    assert.deepEqual(newer.json.messages.map((message) => message.text), ['Добрый день! Уже чиним.'])

    assert.equal((await t.call('POST', '/me/support/read', player)).status, 204)
    const read = await t.call<{ messages: Message[]; unread: number }>('GET', '/me/support/messages', player)
    assert.equal(read.json.unread, 0)
    assert.equal(read.json.messages[1]!.read, true)

    // A new message: unread again for the owner; answering is reading.
    await t.call('POST', '/me/support/messages', player, { text: 'Спасибо!' })
    const again = await t.call<Threads>('GET', '/accounts/me/admin/support/threads', owner)
    assert.deepEqual([again.json.unread, again.json.threads[0]!.unread, again.json.threads[0]!.lastMessage.text], [1, 1, 'Спасибо!'])
    await t.call('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, owner, { text: 'Пишите, если что.' })
    assert.equal((await t.call<Threads>('GET', '/accounts/me/admin/support/threads', owner)).json.unread, 0)

    // The latest conversation first.
    const other = await t.register('other@example.com')
    await t.call('POST', '/me/support/messages', other, { text: 'Вопрос по подписке' })
    const order = await t.call<Threads>('GET', '/accounts/me/admin/support/threads?limit=10', owner)
    assert.deepEqual(order.json.threads.map((entry) => [entry.email, entry.unread]), [['other@example.com', 1], ['player@example.com', 0]])
    assert.deepEqual((await t.call<Threads>('GET', '/accounts/me/admin/support/threads?limit=1&offset=1', owner)).json.threads.map((entry) => entry.email), ['player@example.com'])

    type Audit = { entries: Array<{ action: string; target: string; details: { id: number } }> }
    const audit = await t.call<Audit>('GET', '/accounts/me/admin/audit', owner)
    const replies = audit.json.entries.filter((entry) => entry.action === 'support.reply')
    assert.equal(replies.length, 2)
    assert.deepEqual([replies[1]!.target, replies[1]!.details.id], ['player@example.com', answer.json.message.id])
    assert.equal(JSON.stringify(audit.json).includes('Уже чиним'), false, 'the audit log keeps no message text')
  } finally {
    await t.close()
  }
})

test('support chat: a session is required; the owner routes answer 404 to everybody else; bad input is refused', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    const playerId = t.idOf('player@example.com')

    assert.equal((await t.call('GET', '/me/support/messages')).status, 401)
    assert.equal((await t.call('POST', '/me/support/messages', undefined, { text: 'Привет' })).status, 401)
    assert.equal((await t.call('POST', '/me/support/read')).status, 401)
    assert.equal((await t.call('GET', '/me/support/messages', 'x'.repeat(43))).status, 401)

    await t.call('POST', '/me/support/messages', player, { text: 'Привет' })
    const ownerRoutes: Array<[string, string, unknown?]> = [
      ['GET', '/accounts/me/admin/support/threads'], ['GET', `/accounts/me/admin/support/threads/${playerId}`],
      ['POST', `/accounts/me/admin/support/threads/${playerId}/messages`, { text: 'Ответ' }], ['POST', `/accounts/me/admin/support/threads/${playerId}/read`],
    ]
    for (const [method, path, body] of ownerRoutes) {
      assert.equal((await t.call(method, path, undefined, body)).status, 401, path)
      assert.equal((await t.call(method, path, player, body)).status, 404, path)
    }
    assert.equal((await t.call<{ messages: Message[] }>('GET', '/me/support/messages', player)).json.messages.length, 1, 'a player cannot answer himself')

    // The owner answers only a player who wrote, and never an id that is not an account's.
    const silent = await t.register('silent@example.com')
    assert.ok(silent)
    assert.equal((await t.call('GET', `/accounts/me/admin/support/threads/${t.idOf('silent@example.com')}`, owner)).status, 404)
    assert.equal((await t.call('POST', `/accounts/me/admin/support/threads/${t.idOf('silent@example.com')}/messages`, owner, { text: 'Привет' })).status, 404)
    assert.equal((await t.call('GET', '/accounts/me/admin/support/threads/not-an-id', owner)).status, 404)
    assert.equal((await t.call('GET', '/accounts/me/admin/support/threads?limit=0', owner)).status, 400)

    const refused: Array<[unknown, RegExp]> = [
      [{ text: '   \n\t ' }, /Напишите сообщение/], [{}, /Напишите сообщение/], [{ text: 5 }, /Напишите сообщение/],
      [{ text: 'я'.repeat(2001) }, /длиннее 2000 символов/], [{ text: 'я'.repeat(8001) }, /длиннее 2000 символов/],
    ]
    for (const [body, message] of refused) {
      const answer = await t.call<{ error: string }>('POST', '/me/support/messages', player, body)
      assert.equal(answer.status, 400, JSON.stringify(body).slice(0, 40))
      assert.match(answer.json.error, message)
    }
    assert.equal((await t.call('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, owner, { text: ' ' })).status, 400)
    assert.equal((await t.call('GET', '/me/support/messages?after=abc', player)).status, 400)
    // 2000 characters after cleaning: the spaces around do not count.
    assert.equal((await t.call('POST', '/me/support/messages', player, { text: `  ${'я'.repeat(2000)}  ` })).status, 201)
    const cleaned = await t.call<{ message: Message }>('POST', '/me/support/messages', player, { text: `Строка${BELL} 1\r\nСтрока 2` })
    assert.equal(cleaned.json.message.text, 'Строка 1\nСтрока 2')
    assert.equal(Number((t.db.prepare('SELECT COUNT(*) AS n FROM support_messages').get() as { n: number }).n), 3)
  } finally {
    await t.close()
  }
})

test('support chat: 20 messages per 10 minutes per account and per address; a refused empty message does not count', async () => {
  assert.deepEqual(SUPPORT_CHAT_RATE_LIMITS, { perAccount: 20, perIp: 20, windowMs: 10 * 60 * 1000 })
  const t = await setup({ perAccount: 2, perIp: 3 })
  try {
    const a = await t.register('a@example.com')
    const b = await t.register('b@example.com')
    const from = (ip: string) => ({ 'x-forwarded-for': ip })
    assert.equal((await t.call('POST', '/me/support/messages', a, { text: ' ' }, from('203.0.113.1'))).status, 400)
    assert.equal((await t.call('POST', '/me/support/messages', a, { text: 'Раз' }, from('203.0.113.1'))).status, 201)
    assert.equal((await t.call('POST', '/me/support/messages', a, { text: 'Два' }, from('203.0.113.1'))).status, 201)
    const limited = await t.call<{ error: string }>('POST', '/me/support/messages', a, { text: 'Три' }, from('203.0.113.9'))
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
    assert.match(limited.json.error, /Слишком много сообщений/)
    // Another account from the same address: the address has room for one more.
    assert.equal((await t.call('POST', '/me/support/messages', b, { text: 'Раз' }, from('203.0.113.1'))).status, 201)
    assert.equal((await t.call('POST', '/me/support/messages', b, { text: 'Два' }, from('203.0.113.1'))).status, 429)
    assert.equal((await t.call('POST', '/me/support/messages', b, { text: 'Два' }, from('203.0.113.2'))).status, 201)
    // Reading is not limited by the sending limit.
    assert.equal((await t.call<{ messages: Message[] }>('GET', '/me/support/messages', a)).json.messages.length, 2)
  } finally {
    await t.close()
  }
})

test('support chat: the answer wakes the player\'s app at once, a player\'s message wakes the owner app with the unread count', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    const playerId = t.idOf('player@example.com')

    // «Заявки» in the owner app: the old field stays, the conversations with unseen messages come next to it.
    type Events = { version: number; open: number; unreadChats: number }
    const first = await t.call<Events>('GET', '/accounts/me/admin/requests/events', owner)
    assert.deepEqual([first.json.open, first.json.unreadChats], [0, 0])
    const ownerWaits = t.call<Events>('GET', `/accounts/me/admin/requests/events?since=${first.json.version}`, owner)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal((await t.call('POST', '/me/support/messages', player, { text: 'Есть кто?' })).status, 201)
    const woke = await ownerWaits
    assert.ok(woke.json.version > first.json.version)
    assert.deepEqual([woke.json.open, woke.json.unreadChats], [0, 1])

    // The player's app waits on the social events: the owner's answer moves them.
    const before = (await t.call<{ version: number }>('GET', '/me/social-events', player)).json.version
    const playerWaits = t.call<{ version: number }>('GET', `/me/social-events?since=${before}`, player)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal((await t.call('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, owner, { text: 'Да, слушаю.' })).status, 201)
    assert.notEqual((await playerWaits).json.version, before)
    // Answering was reading: the owner app's count is back to 0.
    assert.equal((await t.call<Events>('GET', '/accounts/me/admin/requests/events', owner)).json.unreadChats, 0)

    // The player reads the answer: his other devices are told (the badge goes there too).
    const seen = (await t.call<{ version: number }>('GET', '/me/social-events', player)).json.version
    const otherDevice = t.call<{ version: number }>('GET', `/me/social-events?since=${seen}`, player)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal((await t.call('POST', '/me/support/read', player)).status, 204)
    assert.notEqual((await otherDevice).json.version, seen)
  } finally {
    await t.close()
  }
})

test('support chat: messages are free text on both sides, never scored as an injection by the server guard', async () => {
  const t = await setup()
  try {
    const from = { 'x-forwarded-for': '198.51.100.7' }
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    const injections = () => Number((t.db.prepare("SELECT COUNT(*) AS n FROM security_events WHERE reason = 'injection'").get() as { n: number }).n)
    const quoted = 'Ссылка вида javascript:alert(1) и тег <script> в описании квеста'
    assert.equal((await t.call<{ message: Message }>('POST', '/me/support/messages', player, { text: quoted }, from)).json.message.text, quoted)
    assert.equal((await t.call('POST', `/accounts/me/admin/support/threads/${t.idOf('player@example.com')}/messages`, owner, { text: `Не открывайте ${quoted}` }, from)).status, 201)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(injections(), 0)
    // The guard is on for this address: the same text where free text is not expected counts.
    await t.call('GET', `/me/support/messages?after=${encodeURIComponent('<script>')}`, player, undefined, from)
    assert.equal(injections(), 1)
  } finally {
    await t.close()
  }
})

test('support chat: deleting the account deletes its conversation', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    const stays = await t.register('stays@example.com')
    const playerId = t.idOf('player@example.com')
    await t.call('POST', '/me/support/messages', player, { text: 'Удалите мои данные' })
    await t.call('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, owner, { text: 'Удалите аккаунт в профиле' })
    await t.call('POST', '/me/support/messages', stays, { text: 'Я остаюсь' })

    const deleted = await t.call('POST', '/accounts/me/delete', player, { password })
    assert.ok(deleted.status < 300, JSON.stringify(deleted.json))
    const rows = t.db.prepare('SELECT account_id FROM support_messages').all() as Array<{ account_id: string }>
    assert.deepEqual(rows.map((row) => row.account_id), [t.idOf('stays@example.com')])
    const threads = await t.call<{ threads: Thread[]; total: number }>('GET', '/accounts/me/admin/support/threads', owner)
    assert.deepEqual([threads.json.total, threads.json.threads.map((entry) => entry.email)], [1, ['stays@example.com']])
    assert.equal((await t.call('GET', `/accounts/me/admin/support/threads/${playerId}`, owner)).status, 404)
  } finally {
    await t.close()
  }
})

test('support chat storage: the newest messages of each account are kept, a page is the newest 200, oldest first', () => {
  assert.deepEqual(SUPPORT_CHAT_LIMITS, { keep: 500, page: 200 })
  let clock = Date.parse('2026-10-13T10:00:00.000Z')
  const store = new SupportChatStore(openDatabase(':memory:'), { now: () => (clock += 1000), keep: 5 })
  for (let index = 1; index <= 7; index++) store.add('a', index % 2 ? 'user' : 'owner', `сообщение ${index}`)
  store.add('b', 'user', 'другой игрок')
  assert.deepEqual(store.messages('a').map((message) => message.text), [3, 4, 5, 6, 7].map((index) => `сообщение ${index}`))
  assert.deepEqual(store.messages('b').map((message) => message.text), ['другой игрок'])
  // Unread: the owner's answers for the player, the player's messages for the owner.
  assert.equal(store.unreadForUser('a'), 2)
  assert.deepEqual(store.threads(10, 0).threads.map((entry) => [entry.accountId, entry.unread]), [['b', 1], ['a', 3]])
  assert.equal(store.unreadThreads(), 2)
  assert.equal(store.markRead('a', 'owner'), 3)
  assert.equal(store.markRead('a', 'owner'), 0)
  assert.equal(store.unreadThreads(), 1)

  const many = new SupportChatStore(openDatabase(':memory:'))
  for (let index = 1; index <= 230; index++) many.add('c', 'user', `№${index}`)
  const page = many.messages('c')
  assert.deepEqual([page.length, page[0]!.text, page.at(-1)!.text], [200, '№31', '№230'])
  const after = many.messages('c', page[0]!.id - 1)
  assert.deepEqual([after.length, after[0]!.text], [200, '№31'])
})
