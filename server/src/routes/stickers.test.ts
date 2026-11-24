import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { crc32, deflateSync } from 'node:zlib'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { StickerError, StickerStore, checkStickerPng } from '../services/stickerStore.js'
import { SupportChatStore } from '../services/supportChatStore.js'
import { STICKER_LIMITS } from '../../../src/shared/supportStickers.js'

/**
 * The owner's sticker packs (owner, 07.11.2026: «И там я буду делать паки стикеров. Которые по нажатию кнопки добавить будут
 * добавляться в приложение на ПК и телефон»).
 */
const password = 'correct horse battery'

interface Sticker { id: string; width: number; height: number; size?: number }
interface Pack { id: string; name: string; published: boolean; stickers: Sticker[] }
interface Catalog { version: string; updatedAt: string | null; packs: Array<{ id: string; name: string; stickers: Sticker[] }> }
interface Message { id: number; author: string; text: string; sticker?: string; replyTo?: { id: number; sticker?: string; text: string } }

async function setup() {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined), guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const bytes = Buffer.from(await response.arrayBuffer())
    let json: unknown
    try { json = JSON.parse(bytes.toString('utf8')) } catch { json = undefined }
    return { status: response.status, json: json as T, bytes, headers: response.headers }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  const register = async (email: string) => (await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, country: 'RU' })).json.token
  const idOf = (email: string) => accounts.accountByEmail(email)!.id
  return { db, call, login, register, idOf, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A whole RGBA PNG of `width` × `height` (a colour per row); `extra` bytes of a private chunk make it bigger. */
function realPng(width: number, height: number, extra = 0) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) rows.set([y % 256, x % 256, 120, 255], y * (width * 4 + 1) + 1 + x * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    ...(extra ? [chunk('raId', Buffer.alloc(extra, 7))] : []),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const b64 = (data: Buffer) => data.toString('base64')

test('sticker packs: the owner makes, renames, publishes and orders them; the apps read the published ones only; owner-only', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    const empty = await t.call<Catalog>('GET', '/stickers')
    assert.equal(empty.status, 200)
    assert.equal(empty.headers.get('cache-control'), 'no-store')
    assert.deepEqual([empty.json.packs, empty.json.updatedAt], [[], null])

    // The owner's routes: 401 without a session, 404 for a player.
    assert.equal((await t.call('GET', '/accounts/me/admin/stickers')).status, 401)
    for (const [method, path, body] of [['GET', '/accounts/me/admin/stickers'], ['POST', '/accounts/me/admin/stickers/packs', { name: 'Чужой' }]] as const) {
      assert.equal((await t.call(method, path, player, body)).status, 404)
    }

    const created = await t.call<{ pack: Pack; packs: Pack[] }>('POST', '/accounts/me/admin/stickers/packs', owner, { name: '  Мемы   рейда ' })
    assert.equal(created.status, 201, JSON.stringify(created.json))
    const pack = created.json.pack
    assert.deepEqual([pack.name, pack.published, pack.stickers], ['Мемы рейда', false, []])
    for (const name of ['', '   ', 'x'.repeat(STICKER_LIMITS.name + 1), 5]) {
      const refused = await t.call<{ error: string }>('POST', '/accounts/me/admin/stickers/packs', owner, { name })
      assert.deepEqual([refused.status, refused.json.error], [400, 'Название пака — от 1 до 40 символов'], String(name))
    }

    const png = realPng(512, 512)
    const added = await t.call<{ sticker: Sticker; packs: Pack[] }>('POST', `/accounts/me/admin/stickers/packs/${pack.id}/stickers`, owner, { data: b64(png) })
    assert.equal(added.status, 201, JSON.stringify(added.json))
    const first = added.json.sticker
    assert.deepEqual([first.width, first.height, first.size], [512, 512, png.length])
    assert.match(first.id, /^[a-f0-9]{24}$/)
    // Not published yet: the apps see nothing.
    assert.deepEqual((await t.call<Catalog>('GET', '/stickers')).json.packs, [])

    // «Добавить»: the apps see it.
    assert.equal((await t.call('PUT', `/accounts/me/admin/stickers/packs/${pack.id}`, owner, { published: true })).status, 200)
    const published = (await t.call<Catalog>('GET', '/stickers')).json
    assert.deepEqual(published.packs, [{ id: pack.id, name: 'Мемы рейда', stickers: [{ id: first.id, width: 512, height: 512 }] }])
    assert.ok(published.updatedAt)

    // The picture: the same bytes, kept for a year.
    const image = await t.call('GET', `/stickers/${first.id}.png`)
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/png')
    assert.equal(image.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff')
    assert.ok(image.bytes.equals(png))
    for (const path of [`/stickers/${first.id}`, `/stickers/${first.id}.jpg`, '/stickers/nothing.png', `/stickers/${'0'.repeat(24)}.png`]) assert.equal((await t.call('GET', path)).status, 404, path)

    // Every change of a published pack moves the version: a rename, another sticker, the stickers' order.
    const versions = [published.version]
    assert.equal((await t.call('PUT', `/accounts/me/admin/stickers/packs/${pack.id}`, owner, { name: 'Мемы' })).status, 200)
    versions.push((await t.call<Catalog>('GET', '/stickers')).json.version)
    const second = (await t.call<{ sticker: Sticker }>('POST', `/accounts/me/admin/stickers/packs/${pack.id}/stickers`, owner, { data: `data:image/png;base64,${b64(realPng(300, 200))}` })).json.sticker
    versions.push((await t.call<Catalog>('GET', '/stickers')).json.version)
    const ordered = await t.call<{ packs: Pack[] }>('POST', `/accounts/me/admin/stickers/packs/${pack.id}/order`, owner, { ids: [second.id, first.id] })
    assert.deepEqual(ordered.json.packs[0]!.stickers.map((sticker) => sticker.id), [second.id, first.id])
    const now = (await t.call<Catalog>('GET', '/stickers')).json
    versions.push(now.version)
    assert.equal(new Set(versions).size, 4)
    assert.deepEqual(now.packs[0]!.stickers, [{ id: second.id, width: 300, height: 200 }, { id: first.id, width: 512, height: 512 }])
    // Nothing changed: the same version.
    assert.equal((await t.call<Catalog>('GET', '/stickers')).json.version, now.version)
    // An order that is not every sticker once is refused.
    for (const ids of [[first.id], [first.id, first.id], [first.id, '0'.repeat(24)], 'x']) {
      assert.equal((await t.call('POST', `/accounts/me/admin/stickers/packs/${pack.id}/order`, owner, { ids })).status, 400, JSON.stringify(ids))
    }

    // A second pack, unpublished: only the owner sees it; the packs' order.
    const other = (await t.call<{ pack: Pack }>('POST', '/accounts/me/admin/stickers/packs', owner, { name: 'Черновик' })).json.pack
    const listed = (await t.call<{ packs: Pack[] }>('GET', '/accounts/me/admin/stickers', owner)).json.packs
    assert.deepEqual(listed.map((entry) => [entry.name, entry.published, entry.stickers.length]), [['Мемы', true, 2], ['Черновик', false, 0]])
    assert.deepEqual((await t.call<{ packs: Pack[] }>('POST', '/accounts/me/admin/stickers/packs/order', owner, { ids: [other.id, pack.id] })).json.packs.map((entry) => entry.name), ['Черновик', 'Мемы'])
    assert.equal((await t.call('POST', '/accounts/me/admin/stickers/packs/order', owner, { ids: [pack.id] })).status, 400)
    // Published but empty: not shown.
    await t.call('PUT', `/accounts/me/admin/stickers/packs/${other.id}`, owner, { published: true })
    assert.deepEqual((await t.call<Catalog>('GET', '/stickers')).json.packs.map((entry) => entry.name), ['Мемы'])

    // «Убрать»: gone from the apps; the picture stays for the messages that carry it.
    await t.call('PUT', `/accounts/me/admin/stickers/packs/${pack.id}`, owner, { published: false })
    assert.deepEqual((await t.call<Catalog>('GET', '/stickers')).json.packs, [])
    assert.equal((await t.call('GET', `/stickers/${first.id}.png`)).status, 200)
    // A deleted sticker: no picture; a deleted pack takes its stickers along.
    assert.equal((await t.call('DELETE', `/accounts/me/admin/stickers/${first.id}`, owner)).status, 200)
    assert.equal((await t.call('GET', `/stickers/${first.id}.png`)).status, 404)
    assert.equal((await t.call('DELETE', `/accounts/me/admin/stickers/${first.id}`, owner)).status, 404)
    assert.equal((await t.call('DELETE', `/accounts/me/admin/stickers/packs/${pack.id}`, owner)).status, 200)
    assert.equal((await t.call('GET', `/stickers/${second.id}.png`)).status, 404)
    assert.equal(Number((t.db.prepare('SELECT COUNT(*) AS n FROM sticker_images').get() as { n: number }).n), 0)
    assert.equal((await t.call('DELETE', `/accounts/me/admin/stickers/packs/${pack.id}`, owner)).status, 404)
    assert.equal((await t.call('PUT', `/accounts/me/admin/stickers/packs/${pack.id}`, owner, { published: true })).status, 404)
    assert.equal((await t.call('PUT', `/accounts/me/admin/stickers/packs/${other.id}`, owner, {})).status, 400)
    // A player cannot change anything.
    assert.equal((await t.call('DELETE', `/accounts/me/admin/stickers/packs/${other.id}`, player)).status, 404)
    assert.equal((await t.call('POST', `/accounts/me/admin/stickers/packs/${other.id}/stickers`, player, { data: b64(png) })).status, 404)

    // The owner's audit log.
    const actions = (t.db.prepare("SELECT action FROM owner_audit_log WHERE action LIKE 'stickers.%' ORDER BY id").all() as Array<{ action: string }>).map((row) => row.action)
    assert.ok(actions.includes('stickers.publish') && actions.includes('stickers.pack') && actions.includes('stickers.sticker'), actions.join(','))
  } finally {
    await t.close()
  }
})

test('sticker uploads: a PNG by its bytes, at most 512 KB and 512 × 512; a cut-off one is refused', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const pack = (await t.call<{ pack: Pack }>('POST', '/accounts/me/admin/stickers/packs', owner, { name: 'Проверка' })).json.pack
    const upload = (data: string) => t.call<{ error: string }>('POST', `/accounts/me/admin/stickers/packs/${pack.id}/stickers`, owner, { data })
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 10, 0, 10, 3, 0, 0, 0, 0, 0, 0])
    const whole = realPng(64, 64)
    for (const [data, error] of [
      [b64(jpeg), 'Стикер — только картинка PNG'],
      [b64(realPng(513, 10)), 'Стикер больше 512×512 точек'],
      [b64(realPng(10, 600)), 'Стикер больше 512×512 точек'],
      [b64(whole.subarray(0, whole.length - 12)), 'Повреждённый файл стикера'],
      [b64(realPng(16, 16, STICKER_LIMITS.bytes)), 'Стикер больше 512 КБ'],
      ['не base64!', 'Повреждённый файл стикера'],
      ['', 'Повреждённый файл стикера'],
    ] as const) {
      const refused = await upload(data)
      assert.deepEqual([refused.status, refused.json?.error], [400, error])
    }
    // Declared as a PNG data: URL or not, only the bytes count.
    assert.equal((await upload(`data:image/png;base64,${b64(whole)}`)).status, 201)
    assert.equal((await t.call('POST', `/accounts/me/admin/stickers/packs/${'0'.repeat(24)}/stickers`, owner, { data: b64(whole) })).status, 404)
    assert.equal((await t.call('POST', '/accounts/me/admin/stickers/packs/not-a-pack/stickers', owner, { data: b64(whole) })).status, 404)
  } finally {
    await t.close()
  }
})

test('sticker store: at most 50 packs and 120 stickers a pack; an older database keeps its packs; PNG checks', () => {
  const db = openDatabase(':memory:')
  let clock = Date.parse('2026-11-08T10:00:00.000Z')
  const store = new StickerStore(db, { now: () => (clock += 1000) })
  const packs = Array.from({ length: STICKER_LIMITS.packs }, (_, index) => store.createPack(`Пак ${index + 1}`))
  assert.throws(() => store.createPack('Лишний'), (error: unknown) => error instanceof StickerError && error.status === 409)
  const png = realPng(8, 8)
  for (let index = 0; index < STICKER_LIMITS.perPack; index += 1) store.addSticker(packs[0]!.id, png)
  assert.throws(() => store.addSticker(packs[0]!.id, png), (error: unknown) => error instanceof StickerError && error.status === 409)
  // Created again on the same database (a restart): nothing is lost.
  const again = new StickerStore(db)
  assert.equal(again.packs().length, STICKER_LIMITS.packs)
  assert.equal(again.packs()[0]!.stickers.length, STICKER_LIMITS.perPack)
  // describe(): only stickers that exist, with their pack and whether it is published.
  const sticker = again.packs()[0]!.stickers[0]!.id
  assert.deepEqual([...again.describe([sticker, '0'.repeat(24), 'rat'])], [[sticker, { pack: 'Пак 1', published: false }]])
  assert.deepEqual(checkStickerPng(realPng(512, 512)), { width: 512, height: 512 })
  assert.throws(() => checkStickerPng(Buffer.alloc(0)), StickerError)
})

test('support chat with the owner\'s stickers: only one of a published pack; deleted later it reads «[стикер]», and so does its quote', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    const playerId = t.idOf('player@example.com')
    const pack = (await t.call<{ pack: Pack }>('POST', '/accounts/me/admin/stickers/packs', owner, { name: 'Мемы' })).json.pack
    const sticker = (await t.call<{ sticker: Sticker }>('POST', `/accounts/me/admin/stickers/packs/${pack.id}/stickers`, owner, { data: b64(realPng(128, 128)) })).json.sticker
    const send = (body: unknown) => t.call<{ message: Message; error?: string }>('POST', '/me/support/messages', player, body)

    // Not published yet, unknown, or one of the dropped built-in stickers: refused, nothing written.
    for (const id of [sticker.id, '0'.repeat(24), 'gg', 'rip', 'extract']) {
      const refused = await send({ sticker: id })
      assert.deepEqual([refused.status, refused.json.error], [400, 'Неизвестный стикер'], id)
    }
    assert.equal((await t.call<{ messages: Message[] }>('GET', '/me/support/messages', player)).json.messages.length, 0)

    await t.call('PUT', `/accounts/me/admin/stickers/packs/${pack.id}`, owner, { published: true })
    const sent = await send({ text: '', sticker: sticker.id })
    assert.equal(sent.status, 201, JSON.stringify(sent.json))
    assert.deepEqual([sent.json.message.sticker, sent.json.message.text], [sticker.id, '[стикер: Мемы]'])
    // A built-in one still goes; the owner answers the sticker with a sticker, quoting it.
    assert.equal((await send({ sticker: 'rat' })).status, 201)
    const answer = await t.call<{ message: Message }>('POST', `/accounts/me/admin/support/threads/${playerId}/messages`, owner, { text: '', sticker: sticker.id, replyTo: sent.json.message.id })
    assert.equal(answer.status, 201, JSON.stringify(answer.json))
    assert.deepEqual(answer.json.message.replyTo, { id: sent.json.message.id, author: 'user', text: '', sticker: sticker.id })
    // A sticker goes alone.
    assert.equal((await send({ sticker: sticker.id, text: 'и текст' })).status, 400)

    // «Убрать»: no new message with it; the ones sent still show it.
    await t.call('PUT', `/accounts/me/admin/stickers/packs/${pack.id}`, owner, { published: false })
    assert.equal((await send({ sticker: sticker.id })).status, 400)
    let messages = (await t.call<{ messages: Message[] }>('GET', '/me/support/messages', player)).json.messages
    assert.deepEqual(messages.map((message) => message.sticker), [sticker.id, 'rat', sticker.id])

    // Deleted: the messages read «[стикер]» without the sticker, the quote without it; the built-in one stays.
    await t.call('DELETE', `/accounts/me/admin/stickers/${sticker.id}`, owner)
    messages = (await t.call<{ messages: Message[] }>('GET', '/me/support/messages', player)).json.messages
    assert.deepEqual(messages.map((message) => [message.sticker ?? null, message.text]), [[null, '[стикер]'], ['rat', '[стикер: Крыса]'], [null, '[стикер]']])
    assert.deepEqual(messages[2]!.replyTo, { id: sent.json.message.id, author: 'user', text: '[стикер]' })
    const threads = (await t.call<{ threads: Array<{ lastMessage: Message }> }>('GET', '/accounts/me/admin/support/threads', owner)).json.threads
    assert.deepEqual([threads[0]!.lastMessage.text, 'sticker' in threads[0]!.lastMessage], ['[стикер]', false])
  } finally {
    await t.close()
  }
})

test('support chat storage: a message of a dropped built-in sticker reads «[стикер]»; without the packs only built-in stickers go', () => {
  const db = openDatabase(':memory:')
  const store = new SupportChatStore(db)
  db.prepare("INSERT INTO support_messages (account_id, author, body, created_at, sticker) VALUES ('a', 'user', '', 1000, 'gg')").run()
  const [old] = store.messages('a')
  assert.deepEqual([old!.text, 'sticker' in old!], ['[стикер]', false])
  assert.equal(store.add('a', 'user', '', [], undefined, { sticker: 'heal' }).text, '[стикер: Хилюсь]')
  assert.throws(() => store.add('a', 'user', '', [], undefined, { sticker: 'a'.repeat(24) }), (error: unknown) => (error as { status?: number }).status === 400)
})
