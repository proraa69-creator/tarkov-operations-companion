// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDataset, RaidMode } from '../src/domain/types'

/**
 * The catalog through the desktop gateway against a real API server (server/src/app.ts on a random port): the page gets
 * the catalog's content version, and asking with it while nothing changed costs an empty 304 — the page is told
 * `{ notModified: true }` instead of receiving the whole catalog again.
 */
const state = vi.hoisted(() => ({ dir: '', remote: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => false, buildDefaultServerUrl: () => state.remote, buildEntitlementKeys: () => ({}) }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { accountLogin, catalogRequest, serviceRequest, setServerUrl } = await import('./serviceGateway')
const { createApi } = await import('../server/src/app')
const { AccountStore } = await import('../server/src/services/accountStore')
const { ProgressStore } = await import('../server/src/services/progressStore')
const { openDatabase } = await import('../server/src/services/database')

const password = 'correct horse battery'
const served = { quests: ['q1'], loadedAt: '2026-10-14T09:00:00.000Z', requests: 0 }
const catalogSnapshot = async (mode: RaidMode) => {
  served.requests += 1
  return {
    maps: [], markers: [], items: [], hideout: [], traders: [],
    quests: served.quests.map((id) => ({ id, name: id })),
    metadata: { source: 'json.tarkov.dev', mode, loadedAt: served.loadedAt, counts: {} },
  } as unknown as AppDataset
}
let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-catalog-'))
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  // The owner's account reads the paid routes without a device (server/src/routes/data.ts).
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  server = createApi(new ProgressStore(':memory:'), undefined, accounts, { catalogSnapshot }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
  await accountLogin('owner@example.com', password)
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('the catalog through the desktop gateway', () => {
  it('turns the page\'s version into If-None-Match and keeps the rest of the address', () => {
    const version = 'a'.repeat(40)
    expect(catalogRequest('/v1/catalog/pvp')).toEqual({ path: '/v1/catalog/pvp' })
    expect(catalogRequest(`/v1/catalog/pve?v=${version}`)).toEqual({ path: '/v1/catalog/pve', headers: { 'if-none-match': `W/"${version}"` } })
    expect(catalogRequest(`/v1/catalog/seasonal?lang=en&v=${version}`)).toEqual({ path: '/v1/catalog/seasonal?lang=en', headers: { 'if-none-match': `W/"${version}"` } })
    expect(catalogRequest('/v1/me/progress/pvp')).toEqual({ path: '/v1/me/progress/pvp' })
  })

  it('gives the page the version, answers «not modified» while it holds, and the whole catalog once it changes', async () => {
    const first = await serviceRequest('GET', '/v1/catalog/pvp') as AppDataset
    expect(first.quests.map((quest) => quest.id)).toEqual(['q1'])
    const version = first.metadata?.contentVersion ?? ''
    expect(version).toMatch(/^[a-f0-9]{40}$/)

    // The server refreshed its copy (a newer loadedAt), nothing else: the page keeps what it has.
    served.loadedAt = '2026-10-14T09:10:00.000Z'
    expect(await serviceRequest('GET', `/v1/catalog/pvp?v=${version}`)).toEqual({ notModified: true })

    served.quests = ['q1', 'q2']
    const changed = await serviceRequest('GET', `/v1/catalog/pvp?v=${version}`) as AppDataset
    expect(changed.quests.map((quest) => quest.id)).toEqual(['q1', 'q2'])
    expect(changed.metadata?.contentVersion).toMatch(/^[a-f0-9]{40}$/)
    expect(changed.metadata?.contentVersion).not.toBe(version)

    // Another mode is never «not modified» with this mode's version; a malformed version is refused before any request.
    const asked = served.requests
    expect(await serviceRequest('GET', `/v1/catalog/pve?v=${changed.metadata!.contentVersion}`)).toMatchObject({ metadata: { mode: 'pve' } })
    await expect(serviceRequest('GET', '/v1/catalog/pvp?v=../../etc')).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(serviceRequest('GET', `/v1/catalog/pvp?v=${version}&lang=en`)).rejects.toThrow('Неизвестный запрос сервиса')
    expect(served.requests).toBe(asked + 1)
  })
})
