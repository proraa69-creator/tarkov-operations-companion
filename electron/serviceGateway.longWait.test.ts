// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Owner, 26.11.2026: «Постоянно какие-то сбои… постоянные потери». The server's long waits (`?since=`) hold a request up
 * to ~25 s; hedged, the app sent each one up to four times 1.5 s apart and cut off every copy but the first answered (two
 * of three such requests ended in 499 at the server). A long wait goes once; an ordinary read is still hedged.
 */
const state = vi.hoisted(() => ({ dir: '', remote: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir, getVersion: () => '0.6.0' },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => false, buildDefaultServerUrl: () => state.remote, buildEntitlementKeys: () => ({}) }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { isLongWait, serviceRequest, setServerUrl } = await import('./serviceGateway')
const { HEDGE_MS } = await import('./hedgedFetch')

/** The server answers later than a hedge goes (HEDGE_MS): a hedged read would go again meanwhile. */
const HOLD_MS = HEDGE_MS + 400
const seen: string[] = []
let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-long-wait-'))
  server = createServer((req, res) => {
    seen.push(req.url ?? '')
    const timer = setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ version: 2 }))
    }, HOLD_MS)
    res.on('close', () => clearTimeout(timer))
  }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('the server’s long waits through the desktop gateway', () => {
  it('a long wait goes once, however long the server holds it', async () => {
    for (const path of ['/v1/map-updates?since=1', '/v1/announcement?since=1']) {
      seen.length = 0
      expect(await serviceRequest('GET', path)).toEqual({ version: 2 })
      expect(seen).toEqual([path])
    }
  })

  it('an ordinary read with no answer yet still goes again on a new connection', async () => {
    seen.length = 0
    expect(await serviceRequest('GET', '/v1/map-updates')).toEqual({ version: 2 })
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(new Set(seen)).toEqual(new Set(['/v1/map-updates']))
  })

  it('knows every long wait of the server, and only with `since`', () => {
    const squad = 'a'.repeat(32)
    for (const path of ['/v1/map-updates?since=4', '/v1/announcement?since=4', '/v1/me/social-events?since=4', '/v1/me/social-events?since=4&state=2', '/v1/accounts/me/admin/requests/events?since=4', '/v1/live/pvp?since=4', '/v1/live/screen/pc?since=4', `/v1/squad-live/${squad}/pve?since=4`]) {
      expect(isLongWait(path), path).toBe(true)
    }
    // The first ask (no version yet) is answered at once, and so are the other reads.
    for (const path of ['/v1/map-updates', '/v1/announcement', '/v1/me/social-events', '/v1/accounts/me/admin/requests/events', '/v1/live/pvp', '/v1/me/state?since=4', '/v1/accounts/me/admin/stats']) {
      expect(isLongWait(path), path).toBe(false)
    }
  })
})
