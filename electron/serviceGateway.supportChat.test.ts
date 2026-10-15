// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * «Чат с поддержкой» through the desktop app's request gateway against a real API server (server/src/app.ts on a random
 * port): the player writes and reads with their session, the owner answers from «Заявки» → «Чаты»; only these paths
 * pass the renderer's whitelist, and the server keeps the owner's routes to the owner.
 */
const state = vi.hoisted(() => ({ dir: '', remote: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => false, buildDefaultServerUrl: () => state.remote }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { accountLogin, accountLogout, accountRegister, serviceRequest, setServerUrl } = await import('./serviceGateway')
const { createApi } = await import('../server/src/app')
const { AccountStore } = await import('../server/src/services/accountStore')
const { ProgressStore } = await import('../server/src/services/progressStore')
const { PaymentStore } = await import('../server/src/services/paymentStore')
const { openDatabase } = await import('../server/src/services/database')

const password = 'correct horse battery'
let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-support-chat-'))
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

interface Message { id: number; author: string; text: string }

describe('support chat through the desktop gateway', () => {
  it('the player writes and reads, the owner answers; nothing outside the whitelist goes out', async () => {
    // Signed out: null at once, never a request without a session.
    expect(await serviceRequest('GET', '/v1/me/support/messages')).toBeNull()

    await accountRegister('player@example.com', password, undefined, 'RU')
    const sent = await serviceRequest('POST', '/v1/me/support/messages', { text: 'Не открывается карта' }) as { message: Message }
    expect(sent.message).toMatchObject({ author: 'user', text: 'Не открывается карта' })
    // A player on the owner's routes: the server says they do not exist.
    await expect(serviceRequest('GET', '/v1/accounts/me/admin/support/threads?limit=100')).rejects.toThrow('Не найдено')
    await accountLogout()

    await accountLogin('owner@example.com', password)
    const listed = await serviceRequest('GET', '/v1/accounts/me/admin/support/threads?limit=100') as { threads: Array<{ accountId: string; email: string; unread: number }>; unread: number }
    expect(listed.unread).toBe(1)
    const thread = listed.threads[0]!
    expect(thread).toMatchObject({ email: 'player@example.com', unread: 1 })
    expect(await serviceRequest('GET', `/v1/accounts/me/admin/support/threads/${thread.accountId}`)).toMatchObject({ messages: [{ text: 'Не открывается карта' }] })
    expect(await serviceRequest('POST', `/v1/accounts/me/admin/support/threads/${thread.accountId}/read`)).toBeNull()
    expect(await serviceRequest('POST', `/v1/accounts/me/admin/support/threads/${thread.accountId}/messages`, { text: 'Уже чиним' })).toMatchObject({ message: { author: 'owner', text: 'Уже чиним' } })
    await accountLogout()

    await accountLogin('player@example.com', password)
    const answers = await serviceRequest('GET', `/v1/me/support/messages?after=${sent.message.id}`) as { messages: Message[]; unread: number }
    expect([answers.messages.map((message) => message.text), answers.unread]).toEqual([['Уже чиним'], 1])
    expect(await serviceRequest('POST', '/v1/me/support/read')).toBeNull()
    expect(await serviceRequest('GET', '/v1/me/support/messages')).toMatchObject({ unread: 0 })
    // «Проблема решена» is the owner's: the player's DELETE reaches the server, which says it does not exist.
    await expect(serviceRequest('DELETE', `/v1/accounts/me/admin/support/threads/${thread.accountId}`)).rejects.toThrow('Не найдено')

    for (const [method, path] of [
      ['GET', '/v1/me/support/messages?after=x'], ['PUT', '/v1/me/support/messages'], ['GET', '/v1/me/support/read'],
      ['GET', '/v1/accounts/me/admin/support/threads?limit=100&x=1'], ['GET', '/v1/accounts/me/admin/support/threads/NOT-AN-ID'],
      ['POST', `/v1/accounts/me/admin/support/threads/${thread.accountId}/delete`],
      ['DELETE', '/v1/me/support/messages'], ['DELETE', '/v1/accounts/me/admin/support/threads'],
      ['DELETE', `/v1/accounts/me/admin/support/threads/${thread.accountId}/messages`], ['DELETE', '/v1/accounts/me/admin/support/threads/NOT-AN-ID'],
    ] as const) {
      await expect(serviceRequest(method, path)).rejects.toThrow('Неизвестный запрос сервиса')
    }
    await accountLogout()

    // The owner: «Проблема решена» deletes the whole conversation (204, null here); the player's chat is empty.
    await accountLogin('owner@example.com', password)
    expect(await serviceRequest('DELETE', `/v1/accounts/me/admin/support/threads/${thread.accountId}`)).toBeNull()
    expect(await serviceRequest('GET', '/v1/accounts/me/admin/support/threads?limit=100')).toMatchObject({ threads: [], total: 0, unread: 0 })
    await accountLogout()
    await accountLogin('player@example.com', password)
    expect(await serviceRequest('GET', '/v1/me/support/messages')).toEqual({ messages: [], unread: 0, oldestId: null })
    await accountLogout()
  })

  it('screenshots (owner, 15.10.2026): sent with a message past 1 MB, read as JSON by the account and the owner only', async () => {
    // A PNG header (1280×720) with padding: 1.5 MB, past the server's global 1 MB body limit.
    const png = Buffer.alloc(1_500_000)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(png)
    png.write('IHDR', 12, 'latin1')
    png.writeUInt32BE(1280, 16)
    png.writeUInt32BE(720, 20)
    await accountRegister('shooter@example.com', password, undefined, 'RU')
    const sent = await serviceRequest('POST', '/v1/me/support/messages', { text: '', images: [{ data: png.toString('base64') }] }) as { message: Message & { attachments: Array<{ id: string; width: number; height: number }> } }
    expect(sent.message.text).toBe('[скриншот]')
    const [shot] = sent.message.attachments
    expect([shot!.width, shot!.height]).toEqual([1280, 720])
    const own = await serviceRequest('GET', `/v1/me/support/attachments/${shot!.id}`) as { mime: string; data: string }
    expect([own.mime, own.data === png.toString('base64')]).toEqual(['image/png', true])
    for (const path of ['/v1/me/support/attachments/NOT-AN-ID', `/v1/me/support/attachments/${shot!.id}/x`, '/v1/me/support/attachments']) {
      await expect(serviceRequest('GET', path)).rejects.toThrow('Неизвестный запрос сервиса')
    }
    await expect(serviceRequest('GET', `/v1/accounts/me/admin/support/attachments/${shot!.id}`)).rejects.toThrow('Не найдено')
    await accountLogout()
    // Another player: as if it did not exist.
    await accountRegister('curious@example.com', password, undefined, 'RU')
    await expect(serviceRequest('GET', `/v1/me/support/attachments/${shot!.id}`)).rejects.toThrow('Скриншот не найден')
    await accountLogout()
    await accountLogin('owner@example.com', password)
    expect(await serviceRequest('GET', `/v1/accounts/me/admin/support/attachments/${shot!.id}`)).toMatchObject({ mime: 'image/png', width: 1280, height: 720 })
    await accountLogout()
  })
})
