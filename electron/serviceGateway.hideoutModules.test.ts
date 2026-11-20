// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * «Админ панель» → «Модули убежища» through the desktop gateway against a real API server: the owner's route is in the renderer's
 * list (a route missing there is refused by the app itself, whatever the server says), and the players' apps get the setting
 * with the notice they already ask for.
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
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-hideout-modules-'))
  const db = openDatabase(':memory:')
  server = createApi(new ProgressStore(':memory:'), undefined, new AccountStore({ db, ownerEmails: ['owner@example.com'] }), { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('«Модули убежища» through the desktop gateway', () => {
  it('the owner\'s route reaches the server (404 for a player); the notice carries the setting', async () => {
    await accountRegister('player@example.com', 'correct horse battery', undefined, 'RU')
    await expect(serviceRequest('GET', '/v1/accounts/me/admin/hideout-modules')).rejects.toThrow(/Не найдено/)
    await expect(serviceRequest('PUT', '/v1/accounts/me/admin/hideout-modules', { mode: 'seasonal', open: [], hidden: [] })).rejects.toThrow(/Не найдено/)
    await expect(serviceRequest('POST', '/v1/accounts/me/admin/hideout-modules', {})).rejects.toThrow('Неизвестный запрос сервиса')
    expect(await serviceRequest('GET', '/v1/announcement')).toMatchObject({ hideoutModules: null })
  })
})
