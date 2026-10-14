// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * «Информация о друге»: the desktop app shares its own level in each mode (src/squad/useShareLevels.ts) through the
 * request gateway against a real API server; only PUT passes the renderer's whitelist.
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
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-levels-'))
  const db = openDatabase(':memory:')
  server = createApi(new ProgressStore(':memory:'), undefined, new AccountStore({ db, ownerEmails: [] }), { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('shared levels through the desktop gateway', () => {
  it('PUT /v1/me/levels goes out with the session; other methods on it do not', async () => {
    // Signed out: null at once, never a request without a session.
    expect(await serviceRequest('PUT', '/v1/me/levels', { modes: {} })).toBeNull()
    await accountRegister('player@example.com', 'correct horse battery', undefined, 'RU')
    const observedAt = new Date(Date.now() - 60_000).toISOString()
    const answer = await serviceRequest('PUT', '/v1/me/levels', { modes: { pve: { level: 39, prestige: null, observedAt } } }) as { modes: Record<string, unknown> }
    expect(answer.modes.pve).toMatchObject({ level: 39, prestige: null })
    await expect(serviceRequest('GET', '/v1/me/levels')).rejects.toThrow('Неизвестный запрос сервиса')
  })
})
