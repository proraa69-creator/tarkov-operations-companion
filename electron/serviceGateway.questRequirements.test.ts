// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The quest constructor's requirements and point descriptions (owner, 15.10.2026) through the desktop app's request
 * gateway against a real API server: the owner adds, reorders and removes a requirement and describes a point; a player
 * reads both from the public lists (without the owner's note) and cannot write.
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
const ADMIN = '/v1/accounts/me/admin/quest-requirements'
const KEY = '5780cf7f2459777de4559322'
let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-quest-requirements-'))
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined), catalog: () => undefined }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('quest requirements and point descriptions through the desktop gateway', () => {
  it('the owner writes, every player reads, a player cannot write', async () => {
    await accountLogin('owner@example.com', password)
    const saved = await serviceRequest('PUT', ADMIN, { questId: 'q1', itemId: KEY, kind: 'key', count: 1, comment: 'Дверь 314' }) as { override: { id: string } }
    const second = await serviceRequest('PUT', ADMIN, { questId: 'q1', itemId: 'a'.repeat(24), kind: 'bring', count: 2 }) as { override: { id: string } }
    const ordered = await serviceRequest('POST', `${ADMIN}/order`, { questId: 'q1', ids: [second.override.id, saved.override.id] }) as { overrides: Array<{ id: string }> }
    expect(ordered.overrides.map((entry) => entry.id)).toEqual([second.override.id, saved.override.id])
    await serviceRequest('POST', `${ADMIN}/${second.override.id}/remove`)
    await serviceRequest('PUT', '/v1/accounts/me/admin/quest-points', { questId: 'q1', markerId: 'quest-zone-q1-a', mapId: 'customs', x: 1, z: 2, kind: 'describe', description: 'Под лестницей', note: 'для себя' })
    await accountLogout()

    await accountRegister('player@example.com', password, undefined, 'RU')
    const requirements = await serviceRequest('GET', '/v1/quest-requirements') as { overrides: Array<Record<string, unknown>> }
    expect(requirements.overrides.map((entry) => [entry.itemId, entry.kind, entry.comment, entry.updatedBy])).toEqual([[KEY, 'key', 'Дверь 314', undefined]])
    const points = await serviceRequest('GET', '/v1/quest-points') as { overrides: Array<Record<string, unknown>> }
    expect(points.overrides.map((entry) => [entry.kind, entry.description, entry.note])).toEqual([['describe', 'Под лестницей', undefined]])
    await expect(serviceRequest('PUT', ADMIN, { questId: 'q1', itemId: KEY, kind: 'key' })).rejects.toThrow('Не найдено')
    await expect(serviceRequest('POST', `${ADMIN}/order`, { questId: 'q1', ids: [] })).rejects.toThrow('Не найдено')
    await expect(serviceRequest('POST', `${ADMIN}/${saved.override.id}/remove`)).rejects.toThrow('Не найдено')
    await expect(serviceRequest('DELETE', `${ADMIN}/${saved.override.id}`)).rejects.toThrow('Неизвестный запрос сервиса')
    await accountLogout()
  })
})
