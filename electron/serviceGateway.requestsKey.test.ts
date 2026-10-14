// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * «Доступ Claude к заявкам» (owner, 14.10.2026) through the owner app's request gateway against a real API server
 * (server/src/app.ts on a random port): the owner reads the state of the read-only key, creates it (the key comes back
 * once), replaces and revokes it; a player is told the route does not exist; the reports read with the key are not
 * reachable from the app at all.
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
const KEY_PATH = '/v1/accounts/me/admin/requests-key'
let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-requests-key-'))
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

describe('the read-only key for the reports through the desktop gateway', () => {
  it('the owner sees, creates, replaces and revokes it; a player is refused; nothing else passes', async () => {
    // Signed out: null at once, never a request without a session.
    expect(await serviceRequest('GET', KEY_PATH)).toBeNull()

    await accountRegister('player@example.com', password)
    await expect(serviceRequest('GET', KEY_PATH)).rejects.toThrow('Не найдено')
    await expect(serviceRequest('POST', KEY_PATH)).rejects.toThrow('Не найдено')
    await expect(serviceRequest('DELETE', KEY_PATH)).rejects.toThrow('Не найдено')
    await accountLogout()

    await accountLogin('owner@example.com', password)
    expect(await serviceRequest('GET', KEY_PATH)).toEqual({ active: false })
    const created = await serviceRequest('POST', KEY_PATH) as { key: string; createdAt: string }
    expect(created.key).toMatch(/^rok_[A-Za-z0-9_-]{43}$/)
    expect(await serviceRequest('GET', KEY_PATH)).toEqual({ active: true, createdAt: created.createdAt })
    const replaced = await serviceRequest('POST', KEY_PATH) as { key: string }
    expect(replaced.key).not.toBe(created.key)
    // 204: the gateway answers null.
    expect(await serviceRequest('DELETE', KEY_PATH)).toBeNull()
    expect(await serviceRequest('GET', KEY_PATH)).toEqual({ active: false })

    // The key is for the cloud environment only: the app never reads the reports with it, and DELETE is for this path only.
    for (const [method, path] of [
      ['GET', '/v1/agent/requests'], ['GET', '/v1/agent/requests?status=all&limit=200'], ['GET', '/v1/agent/requests/1/images/0'],
      ['PUT', KEY_PATH], ['GET', `${KEY_PATH}?x=1`], ['DELETE', `${KEY_PATH}/1`], ['DELETE', '/v1/accounts/me/admin/announcement'],
      ['DELETE', '/v1/accounts/me/admin/bug-reports/1'],
    ] as const) {
      await expect(serviceRequest(method, path)).rejects.toThrow('Неизвестный запрос сервиса')
    }
    await accountLogout()
  })
})
