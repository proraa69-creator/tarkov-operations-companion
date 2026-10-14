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

    await accountRegister('player@example.com', password)
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

    for (const [method, path] of [
      ['GET', '/v1/me/support/messages?after=x'], ['PUT', '/v1/me/support/messages'], ['GET', '/v1/me/support/read'],
      ['GET', '/v1/accounts/me/admin/support/threads?limit=100&x=1'], ['GET', '/v1/accounts/me/admin/support/threads/NOT-AN-ID'],
      ['POST', `/v1/accounts/me/admin/support/threads/${thread.accountId}/delete`],
    ] as const) {
      await expect(serviceRequest(method, path)).rejects.toThrow('Неизвестный запрос сервиса')
    }
    await accountLogout()
  })
})
