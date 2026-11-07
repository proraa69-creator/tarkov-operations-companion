// @vitest-environment node
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StateAdapter } from '../src/sync/playerState'

/** Two of these engines, as two devices, against the real server over HTTP, with the wait the apps keep on the live channel. */
const { createApi } = await import('../server/src/app')
const { AccountStore } = await import('../server/src/services/accountStore')
const { ProgressStore } = await import('../server/src/services/progressStore')
const { PaymentStore } = await import('../server/src/services/paymentStore')
const { UserDataStore } = await import('../server/src/services/userDataStore')
const { openDatabase } = await import('../server/src/services/database')

let server: Server
let base = ''

beforeAll(async () => {
  const db = openDatabase(':memory:')
  server = createApi(new ProgressStore(':memory:'), undefined, new AccountStore({ db, ownerEmails: [] }), { payments: new PaymentStore(db, undefined), userData: new UserDataStore(db) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function signIn(email: string) {
  const response = await fetch(`${base}/v1/accounts/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', country: 'RU' }) })
  return ((await response.json()) as { token: string }).token
}

async function device(name: string, token: string) {
  vi.resetModules()
  const engine = await import('../src/sync/playerState')
  const used = new Map<string, unknown>()
  let written: (() => void) | null = null
  const adapters: StateAdapter[] = [{ kind: 'promo-used', modes: [''], read: () => used, write: (_mode, next) => { used.clear(); for (const [key, value] of next) used.set(key, value); written?.() } }]
  const request = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return response.ok ? response.json() : null
  }
  engine.configurePlayerState({ adapters, transport: request })
  engine.setPlayerStateAccount(`account-of-${name}`)
  const stop = new AbortController()
  // What data/mapUpdates.ts watchVersion does with GET /v1/me/social-events.
  const wait = async () => {
    let version: number | undefined
    while (!stop.signal.aborted) {
      const answer = await request('GET', version === undefined ? '/v1/me/social-events' : `/v1/me/social-events?since=${version}${engine.playerStateChannel.query()}`).catch(() => null) as { version?: number } | null
      if (stop.signal.aborted) return
      engine.playerStateChannel.heard(answer)
      version = answer?.version
    }
  }
  void wait()
  return { engine, used, stop, nextWrite: () => new Promise<void>((resolve) => { written = resolve }) }
}

describe('two devices through the real server', () => {
  it('a tick reaches the other device at once over the live channel, and back; nothing goes round in a circle', async () => {
    const token = await signIn('two-devices@example.com')
    const pc = await device('pc', token)
    const phone = await device('phone', token)
    await Promise.all([pc.engine.syncPlayerState({ pull: true }), phone.engine.syncPlayerState({ pull: true })])
    await new Promise((resolve) => setTimeout(resolve, 100))

    let arrived = phone.nextWrite()
    const started = Date.now()
    pc.used.set('COPIED', true)
    pc.engine.schedulePlayerStateSync()
    await arrived
    expect(Date.now() - started).toBeLessThan(1000)
    expect([...phone.used.keys()]).toEqual(['COPIED'])

    arrived = pc.nextWrite()
    phone.used.delete('COPIED')
    phone.used.set('FROM-PHONE', true)
    phone.engine.schedulePlayerStateSync()
    await arrived
    expect([...pc.used.keys()]).toEqual(['FROM-PHONE'])

    // Quiet now: the counter stays where it is, whatever the two do on their rounds.
    const rev = async () => ((await (await fetch(`${base}/v1/me/state`, { headers: { authorization: `Bearer ${token}` } })).json()) as { rev: number }).rev
    const before = await rev()
    await Promise.all([pc.engine.syncPlayerState({ pull: true }), phone.engine.syncPlayerState({ pull: true })])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await rev()).toBe(before)
    pc.stop.abort()
    phone.stop.abort()
  })
})
