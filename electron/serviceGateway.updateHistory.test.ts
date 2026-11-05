// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * «История обновлений» through the owner app's request gateway against a real API server (server/src/app.ts on a random
 * port): signed out nothing is sent, a player is told the route does not exist, the owner gets the list.
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
const PATH = '/v1/accounts/me/admin/update-history'
let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-update-history-'))
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('«История обновлений» through the desktop gateway', () => {
  it('passes the gateway for the owner; a player and other methods are refused', async () => {
    expect(await serviceRequest('GET', PATH)).toBeNull()

    await accountRegister('player@example.com', password, undefined, 'RU')
    await expect(serviceRequest('GET', PATH)).rejects.toThrow('Не найдено')
    await accountLogout()

    await accountLogin('owner@example.com', password)
    const { versions } = await serviceRequest('GET', PATH) as { versions: Array<{ version: string }> }
    expect(versions.at(-1)?.version).toBe('0.1.0')
    await expect(serviceRequest('POST', PATH)).rejects.toThrow()
    await expect(serviceRequest('GET', `${PATH}?all=1`)).rejects.toThrow()
  })
})
