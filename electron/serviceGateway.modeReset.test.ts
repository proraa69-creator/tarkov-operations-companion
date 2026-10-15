// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * «Престиж +» / a nickname change (src/state/modeReset.ts): the reset of one mode goes through the request gateway
 * against a real API server, with the session; only POST on that path passes the renderer's whitelist.
 */
const state = vi.hoisted(() => ({ dir: '', remote: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => false, buildDefaultServerUrl: () => state.remote }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { accountRegister, serviceRequest, setServerUrl } = await import('./serviceGateway')
const { createApi } = await import('../server/src/app')
const { AccountStore } = await import('../server/src/services/accountStore')
const { ProgressStore } = await import('../server/src/services/progressStore')
const { PaymentStore } = await import('../server/src/services/paymentStore')
const { openDatabase } = await import('../server/src/services/database')

let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-mode-reset-'))
  const db = openDatabase(':memory:')
  server = createApi(new ProgressStore(':memory:'), undefined, new AccountStore({ db, ownerEmails: [] }), { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('the reset of one mode through the desktop gateway', () => {
  it('POST /v1/me/progress/:mode/reset goes out with the session; other modes and methods do not pass', async () => {
    // Signed out: null at once, never a request without a session (the reset stays queued in the app).
    expect(await serviceRequest('POST', '/v1/me/progress/pve/reset', { at: new Date().toISOString() })).toBeNull()
    await accountRegister('prestige@example.com', 'correct horse battery', undefined, 'RU')
    const at = new Date(Date.now() - 60_000).toISOString()
    const answer = await serviceRequest('POST', '/v1/me/progress/pve/reset', { at }) as { resetAt: string }
    expect(answer.resetAt).toBe(at)
    await expect(serviceRequest('GET', '/v1/me/progress/pve/reset')).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(serviceRequest('POST', '/v1/me/progress/arena/reset', { at })).rejects.toThrow('Неизвестный запрос сервиса')
  })
})
