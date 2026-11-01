// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * «Поиск квестов по экрану для игрока» through the desktop gateway against a real API server (owner, 01.11.2026: «при
 * вводе почты в админ панели… ничего не происходит» — the paths were missing from the renderer's whitelist).
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
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-trials-'))
  const db = openDatabase(':memory:')
  server = createApi(new ProgressStore(':memory:'), undefined, new AccountStore({ db, ownerEmails: ['owner@example.com'] }), { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('the quest screen search for one player through the desktop gateway', () => {
  it('the player\'s app may ask GET /v1/me/features; the owner routes reach the server (404 for a player)', async () => {
    await accountRegister('player@example.com', 'correct horse battery', undefined, 'RU')
    expect(await serviceRequest('GET', '/v1/me/features')).toEqual({ features: { questTableScan: null } })
    await expect(serviceRequest('GET', '/v1/accounts/me/admin/trial-features')).rejects.toThrow(/Не найдено/)
    await expect(serviceRequest('PUT', '/v1/accounts/me/admin/trial-features', { email: 'player@example.com', feature: 'questTableScan', hours: 24 })).rejects.toThrow(/Не найдено/)
    await expect(serviceRequest('POST', '/v1/accounts/me/admin/trial-features', {})).rejects.toThrow('Неизвестный запрос сервиса')
  })
})
