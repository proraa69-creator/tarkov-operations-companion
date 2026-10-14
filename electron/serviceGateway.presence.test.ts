// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * «Онлайн сейчас» (owner, 14.10.2026) through the desktop request gateway against a real API server: the heartbeat goes
 * with this PC's device id (registered at sign-in, POST /v1/entitlement), so the server counts it as the PC app; the owner
 * reads the count, a player is told the route does not exist.
 */
const state = vi.hoisted(() => ({ dir: '', remote: '', key: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir, getVersion: () => '0.6.0' },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => false, buildDefaultServerUrl: () => state.remote, buildEntitlementKeys: () => ({ [state.remote]: state.key }) }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { accountLogin, accountLogout, accountRegister, refreshEntitlement, serviceRequest, setServerUrl } = await import('./serviceGateway')
const { createApi } = await import('../server/src/app')
const { AccountStore } = await import('../server/src/services/accountStore')
const { ProgressStore } = await import('../server/src/services/progressStore')
const { PaymentStore } = await import('../server/src/services/paymentStore')
const { EntitlementService } = await import('../server/src/services/entitlement')
const { openDatabase } = await import('../server/src/services/database')

const password = 'correct horse battery'
const ONLINE = '/v1/accounts/me/admin/online'
let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-presence-'))
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const entitlements = new EntitlementService(accounts)
  state.key = entitlements.publicKey
  server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined), entitlements }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('«Онлайн сейчас» through the desktop gateway', () => {
  it('the heartbeat carries the device and counts as the PC app; only the owner reads the count', async () => {
    // Signed out: nothing is sent.
    expect(await serviceRequest('POST', '/v1/me/presence')).toBeNull()

    await accountRegister('player@example.com', password, undefined, 'RU')
    // Signing in registers this PC as a device of the account (its name starts with the system).
    await refreshEntitlement(true)
    expect(await serviceRequest('POST', '/v1/me/presence')).toBeNull()
    await expect(serviceRequest('GET', ONLINE)).rejects.toThrow('Не найдено')
    await accountLogout()

    await accountLogin('owner@example.com', password)
    const online = await serviceRequest('GET', ONLINE) as { online: number; pc: number; phone: number; windowMinutes: number }
    expect({ online: online.online, pc: online.pc, phone: online.phone, windowMinutes: online.windowMinutes }).toEqual({ online: 1, pc: 1, phone: 0, windowMinutes: 5 })

    // Only these two: no query string, no other method.
    for (const [method, path] of [['GET', '/v1/me/presence'], ['POST', ONLINE], ['GET', `${ONLINE}?x=1`]] as const) {
      await expect(serviceRequest(method, path)).rejects.toThrow('Неизвестный запрос сервиса')
    }
  })
})
