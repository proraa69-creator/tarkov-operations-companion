import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { SUPPORT_CHAT_LIMITS, SUPPORT_IMAGE_STORAGE, SupportChatError, SupportChatStore } from '../services/supportChatStore.js'
import { imageSize } from '../services/imageSize.js'
import { SUPPORT_CHAT_RATE_LIMITS, type SupportChatLimits } from './supportChat.js'
import { cleanSupportText, SUPPORT_IMAGE_PLACEHOLDER } from '../../../src/shared/supportChat.js'

/** «Чат с поддержкой» (owner, 13.10.2026: «сделай обратную связь в приложении, чат с пользователем»). */
const password = 'correct horse battery'

interface Message { id: number; author: 'user' | 'owner'; text: string; createdAt: string; read: boolean; attachments?: Array<{ id: string; width: number; height: number }> }
interface Thread { accountId: string; email: string; nickname?: string; nicknames: Record<string, string>; lastMessage: Message; lastAt: string; unread: number }

async function setup(limits?: Partial<SupportChatLimits>) {
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
  const register = async (email: string) => (await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, country: 'RU' })).json.token
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

    assert.deepEqual((await t.call('GET', '/me/support/messages', player)).json, { messages: [], unread: 0, oldestId: null })
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

    // The owner has seen it: the conversation leaves the unread ones, the player sees their message as read.
    assert.equal((await t.call('POST', `/accounts/me/admin/support/threads/${playerId}/read`, owner)).status, 204)
    assert.equal((await t.call<Threads>('GET', '/accounts/me/admin/support/threads', owner)).json.unread, 0)
    assert.equal((await t.call<{ messages: Message[] }>('GET', '/me/support/messages', player)).json.messages[0]!.read, true)

    const answer = await t.call<{ message: Message }>('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, owner, { text: 'Добрый день! Уже чиним.' })
    assert.equal(answer.status, 201, JSON.stringify(answer.json))
    assert.equal(answer.json.message.author, 'owner')
    const mine = await t.call<{ messages: Message[]; unread: number; oldestId: number }>('GET', '/me/support/messages', player)
    assert.equal(mine.json.unread, 1)
    assert.deepEqual(mine.json.messages.map((message) => [message.author, message.read]), [['user', true], ['owner', false]])
    assert.equal(mine.json.oldestId, sent.json.message.id)
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
      ['DELETE', `/accounts/me/admin/support/threads/${playerId}`],
    ]
    for (const [method, path, body] of ownerRoutes) {
      assert.equal((await t.call(method, path, undefined, body)).status, 401, `${method} ${path}`)
      assert.equal((await t.call(method, path, player, body)).status, 404, `${method} ${path}`)
    }
    const kept = await t.call<{ messages: Message[] }>('GET', '/me/support/messages', player)
    assert.equal(kept.json.messages.length, 1, 'a player can neither answer nor delete their own conversation')

    // Never an id that is not a live account's, on every owner route.
    const unknown = 'f'.repeat(24)
    for (const [method, path, body] of [
      ['GET', `/accounts/me/admin/support/threads/${unknown}`], ['POST', `/accounts/me/admin/support/threads/${unknown}/messages`, { text: 'Привет' }],
      ['POST', `/accounts/me/admin/support/threads/${unknown}/read`], ['DELETE', `/accounts/me/admin/support/threads/${unknown}`],
      ['GET', '/accounts/me/admin/support/threads/not-an-id'], ['DELETE', '/accounts/me/admin/support/threads/not-an-id'],
    ] as Array<[string, string, unknown?]>) {
      const answer = await t.call<{ error: string }>(method, path, owner, body)
      assert.equal(answer.status, 404, `${method} ${path}`)
      assert.equal(answer.json.error, 'Переписка не найдена')
    }
    assert.equal(Number((t.db.prepare('SELECT COUNT(*) AS n FROM support_messages WHERE account_id = ?').get(unknown) as { n: number }).n), 0)
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
  assert.deepEqual(SUPPORT_CHAT_RATE_LIMITS, { perAccount: 20, perIp: 20, windowMs: 10 * 60 * 1000, imagesPerHour: 40 })
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

    // The player reads the answer: their other devices are told (the badge goes there too).
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

test('support chat: the owner writes first to a player who never wrote (owner, 14.10.2026: «открыть чат» from a report)', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('silent@example.com')
    const playerId = t.idOf('silent@example.com')
    t.accounts.setNicknames(playerId, { nickname: 'Silent_Bob' })
    // «Открыть чат» on the report card: the report carries its author's account (routes/bugReports.ts).
    assert.equal((await t.call('POST', '/bug-reports', player, { kind: 'idea', topic: 'Таймер рейда', description: 'Показывать время до конца рейда' })).status, 201)
    type Reports = { reports: Array<{ accountId?: string; email?: string }> }
    const authors = async () => (await t.call<Reports>('GET', '/accounts/me/admin/bug-reports?status=open', owner)).json.reports.map((entry) => [entry.accountId, entry.email])
    assert.deepEqual(await authors(), [[playerId, 'silent@example.com']])

    // Opened from the report: the account, no messages yet; opening alone starts no conversation.
    const opened = await t.call<{ account: { id: string; email: string; nickname?: string }; messages: Message[] }>('GET', `/accounts/me/admin/support/threads/${playerId}`, owner)
    assert.equal(opened.status, 200)
    assert.deepEqual([opened.json.account.id, opened.json.account.email, opened.json.account.nickname, opened.json.messages], [playerId, 'silent@example.com', 'Silent_Bob', []])
    assert.equal((await t.call('POST', `/accounts/me/admin/support/threads/${playerId}/read`, owner)).status, 204)
    assert.equal((await t.call<{ total: number }>('GET', '/accounts/me/admin/support/threads', owner)).json.total, 0)

    // The first message is the owner's: the player's app wakes and counts it.
    const before = (await t.call<{ version: number }>('GET', '/me/social-events', player)).json.version
    const playerWaits = t.call<{ version: number }>('GET', `/me/social-events?since=${before}`, player)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const first = await t.call<{ message: Message }>('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, owner, { text: 'Здравствуйте! По вашему отчёту: какая карта?' })
    assert.equal(first.status, 201, JSON.stringify(first.json))
    assert.notEqual((await playerWaits).json.version, before)
    const mine = await t.call<{ messages: Message[]; unread: number; oldestId: number }>('GET', '/me/support/messages', player)
    assert.deepEqual([mine.json.messages.map((message) => [message.author, message.text]), mine.json.unread, mine.json.oldestId], [[['owner', 'Здравствуйте! По вашему отчёту: какая карта?']], 1, first.json.message.id])

    const listed = await t.call<{ threads: Thread[]; total: number; unread: number }>('GET', '/accounts/me/admin/support/threads', owner)
    assert.deepEqual([listed.json.total, listed.json.unread, listed.json.threads[0]!.accountId, listed.json.threads[0]!.lastMessage.author], [1, 0, playerId, 'owner'])
    type Audit = { entries: Array<{ action: string; target: string }> }
    // The owner started this conversation: support.start, not support.reply (owner, 15.10.2026).
    assert.deepEqual((await t.call<Audit>('GET', '/accounts/me/admin/audit', owner)).json.entries.filter((entry) => entry.action === 'support.start' || entry.action === 'support.reply').map((entry) => [entry.action, entry.target]), [['support.start', 'silent@example.com']])

    // Gone with the account: the report keeps no account (no «Открыть чат» on it), nothing to open or write to.
    assert.ok((await t.call('POST', '/accounts/me/delete', player, { password })).status < 300)
    t.db.prepare('UPDATE accounts SET deletion_at = 0 WHERE deletion_at IS NOT NULL').run(); t.accounts.runDueDeletions()
    assert.deepEqual(await authors(), [[undefined, undefined]])
    assert.equal((await t.call('GET', `/accounts/me/admin/support/threads/${playerId}`, owner)).status, 404)
    assert.equal((await t.call('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, owner, { text: 'Вы тут?' })).status, 404)
    assert.equal(Number((t.db.prepare('SELECT COUNT(*) AS n FROM support_messages').get() as { n: number }).n), 0)
  } finally {
    await t.close()
  }
})

test('support chat: «Проблема решена» deletes the whole conversation for both sides at once; the report stays open', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    const other = await t.register('other@example.com')
    const playerId = t.idOf('player@example.com')
    // The report the owner opened the chat from (routes/bugReports.ts): it carries the author's account.
    const report = await t.call<{ id: number }>('POST', '/bug-reports', player, { kind: 'bug', category: 'map', topic: 'Карта не грузится', description: 'Таможня: чёрный экран' })
    assert.equal(report.status, 201, JSON.stringify(report.json))
    type Reports = { reports: Array<{ id: number; status: string; accountId?: string; email?: string }> }
    const reports = await t.call<Reports>('GET', '/accounts/me/admin/bug-reports?status=open', owner)
    assert.deepEqual(reports.json.reports.map((entry) => [entry.id, entry.accountId, entry.email]), [[report.json.id, playerId, 'player@example.com']])

    const a = await t.call<{ message: Message }>('POST', '/me/support/messages', player, { text: 'Карта не грузится' })
    await t.call('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, owner, { text: 'Обновите приложение' })
    const c = await t.call<{ message: Message }>('POST', '/me/support/messages', player, { text: 'Помогло, спасибо!' })
    await t.call('POST', '/me/support/messages', other, { text: 'Другой вопрос' })

    // Both apps are waiting: the player's on the social events, the owner's on the «Заявки» count.
    type Events = { version: number; open: number; unreadChats: number }
    const events = await t.call<Events>('GET', '/accounts/me/admin/requests/events', owner)
    assert.equal(events.json.unreadChats, 2)
    const ownerWaits = t.call<Events>('GET', `/accounts/me/admin/requests/events?since=${events.json.version}`, owner)
    const before = (await t.call<{ version: number }>('GET', '/me/social-events', player)).json.version
    const playerWaits = t.call<{ version: number }>('GET', `/me/social-events?since=${before}`, player)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const resolved = await t.call('DELETE', `/accounts/me/admin/support/threads/${playerId}`, owner)
    assert.equal(resolved.status, 204)
    assert.equal(resolved.headers.get('cache-control'), 'no-store')
    assert.notEqual((await playerWaits).json.version, before)
    const woke = await ownerWaits
    assert.ok(woke.json.version > events.json.version)
    // The other player's conversation is still unread; the report is still open.
    assert.deepEqual([woke.json.unreadChats, woke.json.open], [1, 1])

    // The player: nothing left, and an app reading only what is new learns it too.
    assert.deepEqual((await t.call('GET', '/me/support/messages', player)).json, { messages: [], unread: 0, oldestId: null })
    assert.deepEqual((await t.call('GET', `/me/support/messages?after=${c.json.message.id}`, player)).json, { messages: [], unread: 0, oldestId: null })
    // The owner: the conversation left the list; the account is still there to write to.
    const listed = await t.call<{ threads: Thread[]; total: number; unread: number }>('GET', '/accounts/me/admin/support/threads', owner)
    assert.deepEqual([listed.json.total, listed.json.unread, listed.json.threads.map((entry) => entry.email)], [1, 1, ['other@example.com']])
    assert.deepEqual((await t.call<{ messages: Message[] }>('GET', `/accounts/me/admin/support/threads/${playerId}`, owner)).json.messages, [])
    assert.equal(Number((t.db.prepare('SELECT COUNT(*) AS n FROM support_messages WHERE account_id = ?').get(playerId) as { n: number }).n), 0)
    assert.deepEqual((await t.call<Reports>('GET', '/accounts/me/admin/bug-reports?status=open', owner)).json.reports.map((entry) => [entry.id, entry.status]), [[report.json.id, 'open']])

    // Nothing left to delete: still 204.
    assert.equal((await t.call('DELETE', `/accounts/me/admin/support/threads/${playerId}`, owner)).status, 204)
    type Audit = { entries: Array<{ action: string; target: string; details: { messages: number } }> }
    const audit = await t.call<Audit>('GET', '/accounts/me/admin/audit', owner)
    const resolves = audit.json.entries.filter((entry) => entry.action === 'support.resolve')
    assert.deepEqual(resolves.map((entry) => [entry.target, entry.details.messages]).sort((x, y) => Number(y[1]) - Number(x[1])), [['player@example.com', 3], ['player@example.com', 0]])
    assert.equal(JSON.stringify(audit.json).includes('Помогло'), false, 'the audit log keeps no message text')

    // A new message starts a new conversation after the deleted one.
    const again = await t.call<{ message: Message }>('POST', '/me/support/messages', player, { text: 'Снова вопрос' })
    assert.ok(again.json.message.id > c.json.message.id && again.json.message.id > a.json.message.id)
    const fresh = await t.call<{ messages: Message[]; oldestId: number }>('GET', '/me/support/messages', player)
    assert.deepEqual([fresh.json.messages.map((message) => message.text), fresh.json.oldestId], [['Снова вопрос'], again.json.message.id])
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
    // The deletion runs 10 days after the request (AccountStore.runDueDeletions).
    t.db.prepare('UPDATE accounts SET deletion_at = 0 WHERE deletion_at IS NOT NULL').run(); t.accounts.runDueDeletions()
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
  // The oldest kept message, and «Проблема решена»: one account's whole conversation, nobody else's.
  assert.equal(store.oldestId('a'), store.messages('a')[0]!.id)
  assert.equal(store.oldestId('nobody'), null)
  assert.equal(store.deleteThread('b'), 1)
  assert.equal(store.deleteThread('b'), 0)
  assert.deepEqual([store.messages('b'), store.oldestId('b'), store.unreadThreads(), store.threads(10, 0).total], [[], null, 0, 1])
  assert.equal(store.messages('a').length, 5)

  const many = new SupportChatStore(openDatabase(':memory:'))
  for (let index = 1; index <= 230; index++) many.add('c', 'user', `№${index}`)
  const page = many.messages('c')
  assert.deepEqual([page.length, page[0]!.text, page.at(-1)!.text], [200, '№31', '№230'])
  const after = many.messages('c', page[0]!.id - 1)
  assert.deepEqual([after.length, after[0]!.text], [200, '№31'])
})

test('«Написать пользователю»: the owner finds accounts by part of the e-mail (at most 20, owner only, limited) and starts a chat the player sees', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('kazakh.player@example.com')
    t.accounts.setNicknames(t.idOf('kazakh.player@example.com'), { nickname: 'Steppe_Wolf' })
    for (let index = 0; index < 22; index += 1) await t.accounts.register(`bulk${index}@mail.example`, password, undefined, undefined, 'DE')
    type Found = { users: Array<{ id: string; email: string; nickname?: string; country?: string; region: string; subscription: { status: string }; hasThread: boolean }> }

    assert.equal((await t.call('GET', '/accounts/me/admin/support/search?q=kazakh')).status, 401)
    assert.equal((await t.call('GET', '/accounts/me/admin/support/search?q=kazakh', player)).status, 404, 'players never search')
    assert.equal((await t.call('GET', '/accounts/me/admin/support/search?q=k', owner)).status, 400, 'two characters at least')

    const found = await t.call<Found>('GET', '/accounts/me/admin/support/search?q=KAZAKH', owner)
    assert.equal(found.status, 200)
    assert.deepEqual(found.json.users.map((user) => [user.email, user.nickname, user.country, user.region, user.subscription.status, user.hasThread]), [['kazakh.player@example.com', 'Steppe_Wolf', 'RU', 'cis', 'inactive', false]])
    const many = await t.call<Found>('GET', '/accounts/me/admin/support/search?q=mail.example', owner)
    assert.equal(many.json.users.length, 20, 'at most 20')
    assert.deepEqual((await t.call<Found>('GET', '/accounts/me/admin/support/search?q=bulk1', owner)).json.users[0]!.email.startsWith('bulk1'), true)
    // LIKE wildcards are plain characters.
    assert.deepEqual((await t.call<Found>('GET', '/accounts/me/admin/support/search?q=%25%25', owner)).json.users, [])

    const id = found.json.users[0]!.id
    const sent = await t.call('POST', `/accounts/me/admin/support/threads/${id}/messages`, owner, { text: 'Здравствуйте! Вы участвовали в опросе.' })
    assert.equal(sent.status, 201)
    const mine = await t.call<{ messages: Message[]; unread: number }>('GET', '/me/support/messages', player)
    assert.deepEqual([mine.json.messages.map((message) => message.text), mine.json.unread], [['Здравствуйте! Вы участвовали в опросе.'], 1])
    assert.equal((await t.call<Found>('GET', '/accounts/me/admin/support/search?q=kazakh', owner)).json.users[0]!.hasThread, true)
    const second = await t.call('POST', `/accounts/me/admin/support/threads/${id}/messages`, owner, { text: 'Ещё вопрос' })
    assert.equal(second.status, 201)
    type Audit = { entries: Array<{ action: string; target: string }> }
    const audit = (await t.call<Audit>('GET', '/accounts/me/admin/audit', owner)).json.entries.filter((entry) => entry.action.startsWith('support.')).map((entry) => entry.action)
    assert.deepEqual(audit, ['support.reply', 'support.start'], 'newest first: the thread start, then the reply')

    // 60 searches a minute.
    let limited = 0
    for (let index = 0; index < 60; index += 1) if ((await t.call('GET', '/accounts/me/admin/support/search?q=bulk', owner)).status === 429) limited += 1
    assert.ok(limited > 0)
  } finally {
    await t.close()
  }
})

/** Image headers the server reads (services/imageSize.ts); `pad` bytes after them make a large file. */
function png(width: number, height: number, pad = 0) {
  const head = Buffer.alloc(33 + pad)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(head, 0)
  head.write('IHDR', 12, 'latin1')
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(height, 20)
  return head
}
function jpeg(width: number, height: number) {
  // SOI, an APP0 segment, then SOF0 with the size.
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 0, 0, 0, 0, 0, 0])
}
function webp(chunk: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number) {
  const data = Buffer.alloc(40)
  data.write('RIFF', 0, 'latin1')
  data.writeUInt32LE(32, 4)
  data.write('WEBP', 8, 'latin1')
  data.write(chunk, 12, 'latin1')
  if (chunk === 'VP8 ') { data[23] = 0x9d; data[24] = 0x01; data[25] = 0x2a; data.writeUInt16LE(width, 26); data.writeUInt16LE(height, 28) }
  if (chunk === 'VP8L') { data[20] = 0x2f; data.writeUInt32LE((width - 1) | ((height - 1) << 14), 21) }
  if (chunk === 'VP8X') { data.writeUIntLE(width - 1, 24, 3); data.writeUIntLE(height - 1, 27, 3) }
  return data
}
const b64 = (data: Buffer) => data.toString('base64')

test('support chat screenshots: the size in pixels is read from PNG, JPEG and WEBP headers; broken ones are refused', () => {
  assert.deepEqual(imageSize(png(1920, 1080), 'image/png'), { width: 1920, height: 1080 })
  assert.deepEqual(imageSize(jpeg(800, 600), 'image/jpeg'), { width: 800, height: 600 })
  assert.deepEqual(imageSize(webp('VP8 ', 640, 480), 'image/webp'), { width: 640, height: 480 })
  assert.deepEqual(imageSize(webp('VP8L', 1000, 700), 'image/webp'), { width: 1000, height: 700 })
  assert.deepEqual(imageSize(webp('VP8X', 3840, 2160), 'image/webp'), { width: 3840, height: 2160 })
  assert.equal(imageSize(png(1, 1).subarray(0, 20), 'image/png'), undefined)
  assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0]), 'image/jpeg'), undefined)
  assert.equal(imageSize(png(0, 10), 'image/png'), undefined)
})

test('support chat screenshots: text and images, images only; only the conversation\'s account and the owner read them', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    const other = await t.register('other@example.com')
    const playerId = t.idOf('player@example.com')

    // Two large screenshots (past the global 1 MB body limit together) with a text.
    const big = png(1920, 1080, 900 * 1024)
    const sent = await t.call<{ message: Message }>('POST', '/me/support/messages', player, { text: 'Вот что на экране', images: [{ data: `data:image/png;base64,${b64(big)}` }, { data: b64(jpeg(800, 600)) }] })
    assert.equal(sent.status, 201, JSON.stringify(sent.json))
    assert.equal(sent.json.message.text, 'Вот что на экране')
    const [first, second] = sent.json.message.attachments!
    assert.deepEqual([first!.width, first!.height, second!.width, second!.height], [1920, 1080, 800, 600])
    assert.match(first!.id, /^[a-f0-9]{24}$/)

    // Images only: the text old apps (and the owner's list) show instead.
    const only = await t.call<{ message: Message }>('POST', '/me/support/messages', player, { images: [{ data: b64(webp('VP8X', 640, 480)) }] })
    assert.equal(only.status, 201, JSON.stringify(only.json))
    assert.equal(only.json.message.text, SUPPORT_IMAGE_PLACEHOLDER)
    assert.equal(only.json.message.attachments!.length, 1)
    // A text message keeps its old shape: no `attachments` at all.
    const plain = await t.call<{ message: Message }>('POST', '/me/support/messages', player, { text: 'И ещё вопрос' })
    assert.equal('attachments' in plain.json.message, false)

    const mine = await t.call<{ messages: Message[] }>('GET', '/me/support/messages', player)
    assert.deepEqual(mine.json.messages.map((message) => [message.text, message.attachments?.length ?? 0]), [['Вот что на экране', 2], [SUPPORT_IMAGE_PLACEHOLDER, 1], ['И ещё вопрос', 0]])
    assert.equal('attachments' in mine.json.messages[2]!, false)

    // The player reads their own; the bytes come back as they were sent.
    const own = await t.call<{ mime: string; data: string; width: number; height: number }>('GET', `/me/support/attachments/${first!.id}`, player)
    assert.equal(own.status, 200)
    assert.equal(own.headers.get('cache-control'), 'no-store')
    assert.deepEqual([own.json.mime, own.json.width, own.json.height, own.json.data === b64(big)], ['image/png', 1920, 1080, true])
    // Another account: exactly as for one that does not exist. No session: 401.
    const foreign = await t.call('GET', `/me/support/attachments/${first!.id}`, other)
    assert.deepEqual([foreign.status, foreign.json], [404, { error: 'Скриншот не найден' }])
    assert.equal((await t.call('GET', `/me/support/attachments/${'0'.repeat(24)}`, other)).status, 404)
    assert.equal((await t.call('GET', `/me/support/attachments/${first!.id}`)).status, 401)
    assert.equal((await t.call('GET', `/me/support/attachments/..%2F..%2Fx`, player)).status, 404)
    // The owner's route: the owner only (404 for a player, even for their own screenshot).
    assert.equal((await t.call('GET', `/accounts/me/admin/support/attachments/${first!.id}`, player)).status, 404)
    assert.equal((await t.call('GET', `/accounts/me/admin/support/attachments/${first!.id}`)).status, 401)
    const seen = await t.call<{ mime: string; width: number }>('GET', `/accounts/me/admin/support/attachments/${second!.id}`, owner)
    assert.deepEqual([seen.status, seen.json.mime, seen.json.width], [200, 'image/jpeg', 800])

    // The owner's conversation and list show them; the owner answers with a screenshot too.
    const opened = await t.call<{ messages: Message[] }>('GET', `/accounts/me/admin/support/threads/${playerId}`, owner)
    assert.deepEqual(opened.json.messages.map((message) => message.attachments?.map((attachment) => attachment.id) ?? []), [[first!.id, second!.id], [only.json.message.attachments![0]!.id], []])
    const reply = await t.call<{ message: Message }>('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, owner, { text: '', images: [{ data: b64(png(300, 200)) }] })
    assert.equal(reply.status, 201, JSON.stringify(reply.json))
    assert.deepEqual([reply.json.message.author, reply.json.message.text], ['owner', SUPPORT_IMAGE_PLACEHOLDER])
    const threads = await t.call<{ threads: Thread[] }>('GET', '/accounts/me/admin/support/threads', owner)
    assert.equal(threads.json.threads[0]!.lastMessage.text, SUPPORT_IMAGE_PLACEHOLDER)
    assert.equal(threads.json.threads[0]!.lastMessage.attachments!.length, 1)
    // The player reads the owner's screenshot of their conversation; the other account cannot.
    const answerId = reply.json.message.attachments![0]!.id
    assert.equal((await t.call('GET', `/me/support/attachments/${answerId}`, player)).status, 200)
    assert.equal((await t.call('GET', `/me/support/attachments/${answerId}`, other)).status, 404)

    // «Проблема решена»: the screenshots go with the conversation.
    assert.equal((await t.call('DELETE', `/accounts/me/admin/support/threads/${playerId}`, owner)).status, 204)
    assert.equal((await t.call('GET', `/me/support/attachments/${first!.id}`, player)).status, 404)
    assert.equal((await t.call('GET', `/accounts/me/admin/support/attachments/${answerId}`, owner)).status, 404)
  } finally {
    await t.close()
  }
})

test('support chat screenshots: count, type, size and broken data are checked by the server; a refused one counts nothing', async () => {
  const t = await setup()
  try {
    const player = await t.register('player@example.com')
    const send = (body: unknown) => t.call<{ error: string }>('POST', '/me/support/messages', player, body)
    const shot = { data: b64(png(10, 10)) }
    assert.deepEqual([(await send({ text: 'x', images: [shot, shot, shot, shot, shot] })).json.error], ['Не больше 4 скриншотов'])
    assert.deepEqual((await send({ images: [{ data: b64(Buffer.from('GIF89a......')) }] })).json, { error: 'Скриншоты принимаются только в PNG, JPEG или WEBP' })
    assert.deepEqual((await send({ images: [{ data: '!!!' }] })).json, { error: 'Повреждённый файл скриншота' })
    // A PNG signature without a readable size.
    assert.deepEqual((await send({ images: [{ data: b64(png(10, 10).subarray(0, 16)) }] })).json, { error: 'Повреждённый файл скриншота' })
    const tooBig = await send({ images: [{ data: b64(png(10, 10, 5 * 1024 * 1024)) }] })
    assert.deepEqual([tooBig.status, tooBig.json], [400, { error: 'Скриншот больше 5 МБ' }])
    // Neither text nor images.
    assert.deepEqual((await send({ images: [] })).json, { error: 'Напишите сообщение' })
    assert.deepEqual((await send({ text: '   ', images: [] })).json, { error: 'Напишите сообщение' })
    // Nothing was written.
    assert.deepEqual((await t.call<{ messages: Message[] }>('GET', '/me/support/messages', player)).json.messages, [])
    // Without a session a large body is refused before it is read.
    const unsigned = await t.call('POST', '/me/support/messages', undefined, { images: [{ data: b64(png(10, 10, 2 * 1024 * 1024)) }] })
    assert.equal(unsigned.status, 401)
    // A player on the owner's message route with a large body: 404 unread.
    const playerId = t.idOf('player@example.com')
    assert.equal((await t.call('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, player, { images: [{ data: b64(png(10, 10, 2 * 1024 * 1024)) }] })).status, 404)
  } finally {
    await t.close()
  }
})

test('support chat screenshots: their own hourly limit per account', async () => {
  const t = await setup({ imagesPerHour: 3 })
  try {
    const player = await t.register('player@example.com')
    const shot = { data: b64(png(10, 10)) }
    assert.equal((await t.call('POST', '/me/support/messages', player, { images: [shot, shot] })).status, 201)
    const limited = await t.call<{ error: string }>('POST', '/me/support/messages', player, { images: [shot, shot] })
    assert.equal(limited.status, 429)
    assert.equal(limited.json.error, 'Слишком много скриншотов. Попробуйте через час.')
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
    // One more still fits, and text goes on.
    assert.equal((await t.call('POST', '/me/support/messages', player, { images: [shot] })).status, 201)
    assert.equal((await t.call('POST', '/me/support/messages', player, { text: 'Без картинки' })).status, 201)
  } finally {
    await t.close()
  }
})

test('support chat screenshots: the storage quota (507), retention, the oldest messages and deleted accounts take them along', async () => {
  const db = openDatabase(':memory:')
  let now = Date.parse('2026-10-15T10:00:00Z')
  const full = new SupportChatStore(db, { now: () => now, maxStoredBytes: 100 })
  assert.throws(() => full.add('a'.repeat(24), 'user', '', [png(10, 10, 200)]), (error: unknown) => error instanceof SupportChatError && error.status === 507)
  // Text still goes through.
  assert.equal(full.add('a'.repeat(24), 'user', 'Только текст').text, 'Только текст')

  const store = new SupportChatStore(db, { now: () => now, keep: 2 })
  const account = 'b'.repeat(24)
  const first = store.add(account, 'user', 'Первое', [png(10, 10)])
  assert.ok(store.attachment(first.attachments![0]!.id))
  const second = store.add(account, 'user', '', [png(20, 20)])
  store.add(account, 'owner', 'Ответ')
  // Past `keep`: the oldest message and its screenshot are gone.
  assert.equal(store.attachment(first.attachments![0]!.id), undefined)
  assert.ok(store.attachment(second.attachments![0]!.id))
  // 90 days later: the screenshot is deleted, the message stays with the placeholder.
  now += SUPPORT_IMAGE_STORAGE.retentionMs + 1000
  assert.equal(store.pruneImages(), 1)
  const [kept] = store.messages(account)
  assert.deepEqual([kept!.id, kept!.text, 'attachments' in kept!], [second.id, SUPPORT_IMAGE_PLACEHOLDER, false])
  // A table from before the screenshots gets its column.
  const old = openDatabase(':memory:')
  old.exec('CREATE TABLE support_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, owner_read_at INTEGER, user_read_at INTEGER)')
  old.prepare('INSERT INTO support_messages (account_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(account, 'user', 'Старое сообщение', now)
  const upgraded = new SupportChatStore(old, { now: () => now })
  assert.deepEqual(upgraded.messages(account).map((message) => [message.text, 'attachments' in message]), [['Старое сообщение', false]])
  // Deleting a thread or its messages any other way (a deleted account) takes the screenshots along.
  const third = upgraded.add(account, 'user', 'x', [png(5, 5)])
  old.prepare('DELETE FROM support_messages WHERE account_id = ?').run(account)
  assert.equal(upgraded.attachment(third.attachments![0]!.id), undefined)
})
