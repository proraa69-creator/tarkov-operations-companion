// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review, 27.11.2026 (the players' build since 03.11.2026): a packaged app — the owner's too — takes no server
 * address, device token or site address from the environment (TARKOV_API_URL, TARKOV_API_TOKEN, TARKOV_WEBSITE_URL); a
 * development run still does.
 */
const state = vi.hoisted(() => ({ dir: '', packaged: true }))
vi.mock('electron', () => ({
  app: { get isPackaged() { return state.packaged }, getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => true, buildDefaultServerUrl: () => 'https://raidos.app', buildEntitlementKeys: () => ({}) }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false, LOCAL_SITE_URL: 'http://localhost:5202' }))

state.dir = mkdtempSync(join(tmpdir(), 'raidos-dev-env-'))
const { apiBaseUrl, developmentSyncEnabled } = await import('./serviceGateway')
const { websiteBase } = await import('./accountLinks')

const variables = ['TARKOV_API_URL', 'TARKOV_API_TOKEN', 'TARKOV_WEBSITE_URL'] as const
const saved = Object.fromEntries(variables.map((name) => [name, process.env[name]]))
const setAll = () => {
  process.env.TARKOV_API_URL = 'https://api.elsewhere.example'
  process.env.TARKOV_API_TOKEN = 'a-development-device-token-0123456789'
  process.env.TARKOV_WEBSITE_URL = 'https://site.elsewhere.example/'
}
afterEach(() => { for (const name of variables) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name] } })
afterAll(() => rmSync(state.dir, { recursive: true, force: true }))

describe('the development variables (electron/serviceGateway.ts developmentEnv)', () => {
  it('a packaged owner\'s app ignores them: its own server and site, no development push', async () => {
    state.packaged = true
    setAll()
    expect(apiBaseUrl()).toBe('https://raidos.app')
    expect(developmentSyncEnabled()).toBe(false)
    expect(await websiteBase()).toBe('https://raidos.app')
  })

  it('a development run takes them', async () => {
    state.packaged = false
    setAll()
    expect(apiBaseUrl()).toBe('https://api.elsewhere.example')
    expect(developmentSyncEnabled()).toBe(true)
    expect(await websiteBase()).toBe('https://site.elsewhere.example')
    delete process.env.TARKOV_API_TOKEN
    expect(developmentSyncEnabled()).toBe(false)
  })
})
