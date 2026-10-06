// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * M1: the players' app (client edition) never trusts a server key on first use, so pointing it at a self-made server
 * (another address, TARKOV_API_URL…) cannot produce a valid entitlement. The owner's app keeps trust on first use.
 */
const state = vi.hoisted(() => ({ dir: '', owner: false, keys: {} as Record<string, string> }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir, getVersion: () => '0.5.4' },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => state.owner, buildDefaultServerUrl: () => 'https://raidos.app', buildEntitlementKeys: () => state.keys }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { pinServerKey, trustedKey, mayPinServerKeys } = await import('./entitlement')
const { serverUrlAllowed, setServerUrl } = await import('./serviceGateway')

const newKey = () => (generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }) as { x: string }).x
const OFFICIAL = 'https://raidos.app'
const officialKey = newKey()

beforeAll(async () => { state.dir = await mkdtemp(join(tmpdir(), 'raidos-client-key-')) })
beforeEach(() => { state.owner = false; state.keys = { [OFFICIAL]: officialKey } })

describe('server keys in the players’ app', () => {
  it('refuses trust on first use: a server without a built-in key gets no key and nothing is pinned', async () => {
    expect(mayPinServerKeys('https://evil.example')).toBe(false)
    expect(await pinServerKey('https://evil.example', newKey())).toEqual({ ok: false, reason: 'no-key' })
    expect(await trustedKey('https://evil.example')).toBeUndefined()
    expect((await readdir(state.dir)).filter((name) => name.startsWith('entitlement-keys'))).toEqual([])
  })

  it('uses the built-in key and refuses a different one served by the same address', async () => {
    expect(await trustedKey(OFFICIAL)).toEqual({ key: officialKey, builtIn: true })
    expect(await pinServerKey(OFFICIAL, officialKey)).toEqual({ ok: true, key: officialKey })
    expect(await pinServerKey(OFFICIAL, newKey())).toEqual({ ok: false, reason: 'key-mismatch' })
  })

  it('the owner’s app still pins on first use; a players’ copy ignores such pins', async () => {
    state.owner = true
    const ownKey = newKey()
    expect(await pinServerKey('https://friend.example', ownKey)).toEqual({ ok: true, key: ownKey })
    expect(await trustedKey('https://friend.example')).toEqual({ key: ownKey, builtIn: false })
    state.owner = false
    expect(await trustedKey('https://friend.example')).toBeUndefined()
  })

  it('without a built-in key, the official server (only) is pinned on first use; a different key is refused later', async () => {
    state.keys = {}
    expect(mayPinServerKeys(OFFICIAL)).toBe(true)
    const served = newKey()
    expect(await pinServerKey(OFFICIAL, served)).toEqual({ ok: true, key: served })
    expect(await trustedKey(OFFICIAL)).toEqual({ key: served, builtIn: false })
    expect(await pinServerKey(OFFICIAL, newKey())).toEqual({ ok: false, reason: 'key-mismatch' })
    expect(await pinServerKey('https://evil.example', newKey())).toEqual({ ok: false, reason: 'no-key' })
  })
})

describe('server address in the players’ app', () => {
  it('accepts only the default or a server with a built-in key', () => {
    expect(serverUrlAllowed('')).toBe(true)
    expect(serverUrlAllowed(OFFICIAL)).toBe(true)
    expect(serverUrlAllowed('https://evil.example')).toBe(false)
    expect(serverUrlAllowed('https://raidos.app/evil')).toBe(false)
    expect(serverUrlAllowed('http://127.0.0.1:8787')).toBe(false)
    state.owner = true
    expect(serverUrlAllowed('https://evil.example')).toBe(true)
  })

  it('setServerUrl refuses another server in the players’ app', async () => {
    await expect(setServerUrl('https://evil.example')).rejects.toThrow('адрес сервера не меняется')
    await expect(setServerUrl('evil.example')).rejects.toThrow('адрес сервера не меняется')
  })
})
