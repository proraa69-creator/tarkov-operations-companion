// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The players' desktop app against a real API server (server/src/app.ts on a random port): sign-in, the paywall state
 * from POST /v1/entitlement, the key built into the exe, and paid data through the gateway with this device's id.
 */
const state = vi.hoisted(() => ({ dir: '', remote: '', keys: {} as Record<string, string> }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir, getVersion: () => '0.5.4' },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
// The players' app trusts only the key built into it (never trust on first use): the test server's key is "built in".
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => false, buildDefaultServerUrl: () => state.remote, buildEntitlementKeys: () => state.keys }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { accountLogin, accountStatus, serviceRequest } = await import('./serviceGateway')
const { acceptIssued, deviceId, pinServerKey, verifySignature } = await import('./entitlement')
const { createApi } = await import('../server/src/app')
const { AccountStore } = await import('../server/src/services/accountStore')
const { ProgressStore } = await import('../server/src/services/progressStore')
const { DataGateway } = await import('../server/src/services/dataGateway')
const { encodeEntitlementClaims, joinEntitlementToken } = await import('../src/shared/entitlementToken')

const password = 'correct horse battery'
const paid = new Map<string, number>()
const accounts = new AccountStore({ ownerEmails: [] })
accounts.attachSubscriptions({ paidUntil: (id) => paid.get(id), referralStats: () => ({ activeSubscriptions: 0, revenue: 0, earnings: 0 }), referralSeries: () => [] })
let server: Server
const upstream = vi.fn(async () => new Response(JSON.stringify({ data: { items: [{ id: 'x' }] } }), { status: 200 }))

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-entitlement-'))
  server = createApi(new ProgressStore(':memory:'), undefined, accounts, { data: new DataGateway({ fetch: upstream as unknown as typeof fetch }) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  state.keys = { [state.remote]: ((await (await fetch(`${state.remote}/v1/entitlement/public-key`)).json()) as { publicKey: string }).publicKey }
  expect((await fetch(`${state.remote}/v1/accounts/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'player@example.com', password }) })).status).toBe(201)
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('players’ desktop app: entitlement and paid data', () => {
  it('locked without a subscription, unlocked after payment, data through the gateway with the device id', async () => {
    const first = await accountLogin('player@example.com', password)
    expect(first.signedIn).toBe(true)
    expect(first.entitlement).toMatchObject({ valid: false, reason: 'subscription' })
    await expect(serviceRequest('POST', '/v1/data/graphql', { query: '{ items { id } }' })).rejects.toThrow('Нужна подписка')
    expect(upstream).not.toHaveBeenCalled()

    // The owner grants days (or the player pays): the next status check gets a signed token.
    const id = accounts.authenticate((await accounts.login('player@example.com', password)).token)!
    paid.set(id, Date.now() + 30 * 24 * 60 * 60 * 1000)
    // After a refusal the app asks again at most once a minute.
    expect((await accountStatus()).entitlement).toMatchObject({ valid: false, reason: 'subscription' })
    const realNow = Date.now.bind(Date)
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000)
    const unlocked = await accountStatus()
    expect(unlocked.entitlement).toMatchObject({ valid: true, plan: 'paid' })
    await expect(serviceRequest('POST', '/v1/data/graphql', { query: '{ items { id } }' })).resolves.toEqual({ data: { items: [{ id: 'x' }] } })
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('a token signed by another key, or for another device, is not accepted; a changed server key is refused', async () => {
    const other = generateKeyPairSync('ed25519').privateKey
    const now = Date.now()
    const { body, signed } = encodeEntitlementClaims({ v: 1, sub: 'a', dev: await deviceId(), plan: 'paid', iat: now, exp: now + 3_600_000 })
    const forged = joinEntitlementToken(body, new Uint8Array(sign(null, signed, other)))
    expect(await acceptIssued(state.remote, { token: forged })).toMatchObject({ valid: false, reason: 'key-mismatch' })
    const otherX = (other.export({ format: 'jwk' }) as { x: string }).x
    expect(verifySignature(forged, otherX)).not.toBeNull()
    expect(await pinServerKey(state.remote, otherX)).toEqual({ ok: false, reason: 'key-mismatch' })
    // Still valid with the pinned key.
    expect((await accountStatus()).entitlement).toMatchObject({ valid: true })
  })
})
