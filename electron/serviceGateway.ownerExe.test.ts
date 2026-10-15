// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The owner's in-app update of the whole owner exe (electron/appUpdate.ts) through the gateway, against a real API server
 * (server/src/app.ts on a random port): the signed manifest and a one-time link with the owner's session; a player's
 * session gets nothing, and a player's copy never asks.
 */
const state = vi.hoisted(() => ({ dir: '', remote: '', owner: true }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => state.owner, buildDefaultServerUrl: () => state.remote, buildEntitlementKeys: () => ({}) }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { accountLogin, ownerExeLink, ownerExeManifest, setServerUrl } = await import('./serviceGateway')
const { createApi } = await import('../server/src/app')
const { AccountStore } = await import('../server/src/services/accountStore')
const { openDatabase } = await import('../server/src/services/database')
const { PaymentStore } = await import('../server/src/services/paymentStore')
const { ProgressStore } = await import('../server/src/services/progressStore')

const password = 'correct horse battery'
const bytes = Buffer.from('MZ-owner-exe-for-the-gateway')
const manifest = { edition: 'owner', version: '0.6.1', build: 1792000000500, commit: 'abc-production', size: bytes.length, sha256: '', signature: `${'A'.repeat(86)}==` }
let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-owner-exe-gw-'))
  const exe = join(state.dir, 'RaidOSServer.exe')
  await writeFile(exe, bytes)
  manifest.sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
  await writeFile(join(state.dir, 'RaidOSServer.json'), JSON.stringify(manifest))
  process.env.RAIDOS_SERVER_EXE = exe
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  await first.register('player@example.com', password)
  first.markEmailVerified(first.accountByEmail('player@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(async () => {
  delete process.env.RAIDOS_SERVER_EXE
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(state.dir, { recursive: true, force: true })
})

describe('the owner exe through the gateway (owner\'s session only)', () => {
  it('signed out: no manifest, and the link asks to sign in', async () => {
    expect(await ownerExeManifest()).toBeNull()
    await expect(ownerExeLink()).rejects.toThrow('Войдите в аккаунт владельца, чтобы скачать обновление')
  })

  it('a player\'s account: nothing (the route answers 404 to it)', async () => {
    await accountLogin('player@example.com', password)
    expect(await ownerExeManifest()).toBeNull()
    await expect(ownerExeLink()).rejects.toThrow('Не найдено')
  })

  it('the owner: the served manifest and an absolute one-time link on the same server that serves the exe', async () => {
    await accountLogin('owner@example.com', password)
    expect(await ownerExeManifest()).toEqual(manifest)
    const link = await ownerExeLink()
    expect(link.size).toBe(bytes.length)
    expect(link.url).toMatch(new RegExp(`^${state.remote.replace(/[.]/g, '\\.')}/v1/server-exe/[a-f0-9]{48}$`))
    const download = await fetch(link.url)
    expect(download.status).toBe(200)
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes)
  })

  it('a player\'s copy never asks the owner route, even signed in as the owner', async () => {
    state.owner = false
    const spy = vi.spyOn(globalThis, 'fetch')
    try {
      expect(await ownerExeManifest()).toBeNull()
      await expect(ownerExeLink()).rejects.toThrow()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      state.owner = true
    }
  })
})
