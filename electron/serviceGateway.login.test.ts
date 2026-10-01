// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The owner's sign-in from the desktop app against a real API server (server/src/app.ts on a random port, standing in
 * for https://raidos.app): the owner build talks to the build's server unless the local server mode is on.
 */
const state = vi.hoisted(() => ({ dir: '', remote: '', local: false }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => true, buildDefaultServerUrl: () => state.remote }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => state.local }))

const { accountLogin, accountStatus, defaultApiUrl, forgetLocalPreference, setServerUrl } = await import('./serviceGateway')
const { createApi } = await import('../server/src/app')
const { AccountStore } = await import('../server/src/services/accountStore')
const { ProgressStore } = await import('../server/src/services/progressStore')

const password = 'correct horse battery'
let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-login-'))
  server = createApi(new ProgressStore(':memory:'), undefined, new AccountStore({ ownerEmails: [] })).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const registered = await fetch(`${state.remote}/v1/accounts/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password }) })
  expect(registered.status).toBe(201)
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('owner sign-in from the desktop app', () => {
  it('uses the build server (raidos.app) by default and signs in with the site account', async () => {
    await setServerUrl('')
    expect(defaultApiUrl()).toBe(state.remote)
    const status = await accountLogin('Owner@Example.com', password)
    expect(status).toMatchObject({ signedIn: true, email: 'owner@example.com', online: true, serverUrl: state.remote })
  })

  it('names the server when the password or account does not match it', async () => {
    const host = new URL(state.remote).host
    await expect(accountLogin('nobody@example.com', password)).rejects.toThrow(`Неверный e-mail или пароль для сервера этот компьютер (${host})`)
  })

  it('switches to this PC only while the local server mode is on, and drops the other server\'s session', async () => {
    state.local = true
    forgetLocalPreference()
    const status = await accountStatus()
    expect(status.serverUrl).toBe('http://127.0.0.1:8787')
    expect(status.signedIn).toBe(false)

    state.local = false
    forgetLocalPreference()
    const back = await accountLogin('owner@example.com', password)
    expect(back).toMatchObject({ signedIn: true, serverUrl: state.remote })
  })
})
