// @vitest-environment node
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * What the page asks the server for, through the desktop gateway, against a real API server with real files (owner,
 * 05.11.2026, of «Торговля»: «статистика по этому режиму еще собирается», with the file on the server for days). The gateway's
 * own list never had these paths: it refused them before they left the app, so the server's tests could not see it, and a
 * test build with the statistics packed inside the exe could not either.
 */
const state = vi.hoisted(() => ({ dir: '', remote: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => false, buildDefaultServerUrl: () => state.remote, buildEntitlementKeys: () => ({}) }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { accountLogin, serviceRequest, setServerUrl } = await import('./serviceGateway')
const { createApi } = await import('../server/src/app')
const { AccountStore } = await import('../server/src/services/accountStore')
const { MirrorStorage } = await import('../server/src/services/mirrorStorage')
const { ProgressStore } = await import('../server/src/services/progressStore')
const { openDatabase } = await import('../server/src/services/database')

const REFUSED = 'Неизвестный запрос сервиса'
const password = 'correct horse battery'
const trading = { format: 1, mode: 'regular', builtAt: '2026-11-05T15:11:28.706Z', analyzed: 1, eligible: 1, fee: { offerFeeRate: 0.05, requirementFeeRate: 0.05 }, rows: [], traderItems: [{ id: '5447a9cd4bdc2dbd208b4567', level: 25 }] }
const prices = { mode: 'regular', updatedAt: '2026-11-05T15:11:28.706Z', source: 'json', fleaMarket: { enabled: true }, items: { '5447a9cd4bdc2dbd208b4567': { lastLowPrice: 20_000 } } }
let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-data-routes-'))
  const storage = new MirrorStorage({ root: join(state.dir, 'mirror'), minFreeBytes: 1, freeBytes: async () => 100_000_000 })
  const write = async (slot: string, file: string, body: unknown) => {
    const transaction = await storage.begin(slot)
    await transaction.write(file, JSON.stringify(body))
    await transaction.publish({})
  }
  await write('trading-regular', 'trading.json', trading)
  await write('prices-regular', 'prices.json', prices)
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  // The owner's account reads the paid routes without a device (server/src/routes/data.ts).
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  server = createApi(new ProgressStore(':memory:'), undefined, accounts, { mirrorStorage: storage }).listen(0, '127.0.0.1')
  await new Promise<void>((done) => server.on('listening', done))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
  await accountLogin('owner@example.com', password)
})

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

/** Every `/v1/data/…` path the page's code asks the gateway for, with its blanks filled in. */
async function pathsOfThePage() {
  const found: Array<{ method: string; path: string }> = []
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const at = join(dir, entry.name)
      if (entry.isDirectory()) await walk(at)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const text = await readFile(at, 'utf8')
        for (const match of text.matchAll(/gatewayRequest\('(GET|POST)', [`']((?:\/v1\/data\/)[^`']+)[`']/g)) found.push({ method: match[1]!, path: match[2]! })
      }
    }
  }
  await walk(resolve(import.meta.dirname, '../src'))
  const blanks: Record<string, string> = { mode: 'pvp', itemId: '5447a9cd4bdc2dbd208b4567', safeDays: '30', path: 'regular/items' }
  return found.map(({ method, path }) => ({ method, path: path.replace(/\$\{(\w+)\}/g, (_, name: string) => blanks[name] ?? name) }))
}

describe('the data the page asks for through the desktop gateway', () => {
  it('«Торговля»: the file on the server reaches the page, each mode its own', async () => {
    expect(await serviceRequest('GET', '/v1/data/trading/pvp')).toEqual(trading)
    // No file for this mode: the server's own answer, which the page tells apart from a failed request.
    await expect(serviceRequest('GET', '/v1/data/trading/pve')).rejects.toThrow('ещё собирается')
  })

  it('the minute prices reach the page', async () => {
    expect(await serviceRequest('GET', '/v1/data/prices/pvp')).toEqual(prices)
  })

  it('every /v1/data path in the page\'s code is on the gateway\'s list', async () => {
    const paths = await pathsOfThePage()
    expect(paths.map((entry) => entry.path)).toEqual(expect.arrayContaining(['/v1/data/trading/pvp', '/v1/data/prices/pvp', '/v1/data/price-history/pvp/5447a9cd4bdc2dbd208b4567?days=30', '/v1/data/json/regular/items', '/v1/data/graphql']))
    for (const { method, path } of paths) {
      const outcome = await serviceRequest(method, path, method === 'POST' ? { query: '{ __typename }' } : undefined).then(() => 'answered', (error: Error) => error.message)
      expect(`${path}: ${outcome}`).not.toContain(REFUSED)
    }
  }, 60_000)

  it('still nothing else: a path off the list stops in the app', async () => {
    await expect(serviceRequest('GET', '/v1/data/trading/other')).rejects.toThrow(REFUSED)
    await expect(serviceRequest('POST', '/v1/data/trading/pvp', {})).rejects.toThrow(REFUSED)
    await expect(serviceRequest('GET', '/v1/data/price-history/pvp/../../secret?days=30')).rejects.toThrow(REFUSED)
  })
})
