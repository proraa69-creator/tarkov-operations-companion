// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/** The player's own lists (src/sync/playerState.ts) through the request gateway, against a real API server. */
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
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-state-'))
  const db = openDatabase(':memory:')
  server = createApi(new ProgressStore(':memory:'), undefined, new AccountStore({ db, ownerEmails: [] }), { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('the player\'s own lists through the desktop gateway', () => {
  it('POST and GET /v1/me/state and the wait with the counter go out with the session; nothing else on them passes', async () => {
    expect(await serviceRequest('POST', '/v1/me/state', { since: 0, items: [] })).toBeNull()
    await accountRegister('player@example.com', 'correct horse battery', undefined, 'RU')
    const row = { kind: 'promo-used', mode: '', item: 'CODE', at: Date.now() - 1000, value: true }
    const written = await serviceRequest('POST', '/v1/me/state', { since: 0, items: [row] }) as { rev: number; kept: number }
    expect(written.kept).toBe(1)
    const read = await serviceRequest('GET', '/v1/me/state?since=0') as { items: unknown[] }
    expect(read.items).toEqual([row])
    const answer = await serviceRequest('GET', '/v1/me/social-events') as { version: number; state: number }
    expect(answer.state).toBe(written.rev)
    const moved = await serviceRequest('GET', `/v1/me/social-events?since=${answer.version}&state=0`) as { state: number }
    expect(moved.state).toBe(written.rev)
    await expect(serviceRequest('DELETE', '/v1/me/state')).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(serviceRequest('GET', '/v1/me/state?since=x')).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(serviceRequest('GET', '/v1/me/social-events?state=1')).rejects.toThrow('Неизвестный запрос сервиса')
  })
})
