// @vitest-environment node
import { createHash, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// A throwaway key stands in for the one built into the app (the real private key is never in the repository).
const keys = await vi.hoisted(async () => {
  const { generateKeyPairSync } = await import('node:crypto')
  const pair = generateKeyPairSync('ed25519')
  const stranger = generateKeyPairSync('ed25519')
  return { privateKey: pair.privateKey, strangerKey: stranger.privateKey, publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
})
const build = vi.hoisted(() => ({ owner: false, defaultServer: 'https://raidos.app', userData: '' }))

vi.mock('./updateSigningKey.js', () => ({ UPDATE_SIGNING_PUBLIC_KEY: keys.publicPem }))
vi.mock('electron', () => ({ app: { isPackaged: false, on: vi.fn(), quit: vi.fn(), getPath: () => build.userData } }))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => build.owner, buildDefaultServerUrl: () => build.defaultServer }))
vi.mock('./localServer.js', () => ({ runningBuild: async () => ({ version: '0.5.3', build: 100, commit: 'old', trialLaunches: 0, edition: build.owner ? 'owner' : 'client' }) }))
// The address typed in the app: a player's copy must never update from it.
vi.mock('./serviceGateway.js', () => ({ loadServerUrl: async () => 'https://typed-in.example', apiBaseUrl: () => 'https://typed-in.example' }))

const { canonicalUpdatePayload } = await import('./updateManifest')
const { checkForUpdateNow, setUpdateSettings, startUpdateChecks, updateStatus } = await import('./appUpdate')

const dir = mkdtempSync(join(tmpdir(), 'raidos-update-'))
build.userData = dir
process.env.PORTABLE_EXECUTABLE_FILE = join(dir, 'Raid OS.exe')
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.PORTABLE_EXECUTABLE_FILE })

const exe = Buffer.from('MZ new players build')
const fields = { edition: 'client' as const, version: '0.5.4', build: 200, commit: 'abc1234', size: exe.length, sha256: createHash('sha256').update(exe).digest('hex') }
const signedBy = (key: typeof keys.privateKey, manifest: typeof fields | { edition: 'owner' | 'client'; version: string; build: number; commit: string; size: number; sha256: string } = fields) =>
  ({ ...manifest, signature: sign(null, Buffer.from(canonicalUpdatePayload(manifest), 'utf8'), key).toString('base64') })

let served: { manifest: unknown; exe: Buffer }
const fetchMock = vi.fn(async (url: string) => url.endsWith('/download/version.json')
  ? new Response(JSON.stringify(served.manifest), { headers: { 'content-type': 'application/json' } })
  : new Response(new Uint8Array(served.exe)))
vi.stubGlobal('fetch', fetchMock)
startUpdateChecks(() => {})

describe('auto-update: signed manifests only (electron/appUpdate.ts)', () => {
  beforeEach(() => { fetchMock.mockClear(); build.owner = false; build.defaultServer = 'https://raidos.app' })

  it('a player copy asks only the server built into it, never the address typed in the app', async () => {
    served = { manifest: signedBy(keys.privateKey), exe }
    expect((await checkForUpdateNow()).outcome).toBe('available')
    expect(fetchMock).toHaveBeenCalledWith('https://raidos.app/download/version.json', expect.anything())
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('typed-in.example'))).toBe(true)
    expect(updateStatus()).toMatchObject({ state: 'available', version: '0.5.4', commit: 'abc1234' })
  })

  it('offers nothing without a valid signature: unsigned, tampered or signed with another key', async () => {
    const unsigned: Record<string, unknown> = signedBy(keys.privateKey)
    delete unsigned.signature
    for (const manifest of [unsigned,{ ...signedBy(keys.privateKey), sha256: 'f'.repeat(64) }, { ...signedBy(keys.privateKey), build: 300 }, signedBy(keys.strangerKey)]) {
      served = { manifest, exe }
      expect((await checkForUpdateNow()).outcome).toBe('unsigned')
    }
  })

  it('a signed build of the other edition is not for this copy', async () => {
    served = { manifest: signedBy(keys.privateKey, { ...fields, edition: 'owner' }), exe }
    expect((await checkForUpdateNow()).outcome).toBe('latest')
  })

  it('no HTTPS server built in: nothing to update from', async () => {
    build.defaultServer = 'http://127.0.0.1:8787'
    expect((await checkForUpdateNow()).outcome).toBe('no-server')
    build.defaultServer = ''
    expect((await checkForUpdateNow()).outcome).toBe('no-server')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the owner copy keeps using the server address it talks to', async () => {
    build.owner = true
    served = { manifest: signedBy(keys.privateKey), exe }
    expect((await checkForUpdateNow()).outcome).toBe('latest') // the players' build is never installed on it
    expect(fetchMock).toHaveBeenCalledWith('https://typed-in.example/download/version.json', expect.anything())
  })

  it('the downloaded exe must match the signed SHA-256', async () => {
    served = { manifest: signedBy(keys.privateKey), exe: Buffer.from('MZ swapped exe!!!!!!') } // same size, other bytes
    expect((await checkForUpdateNow()).outcome).toBe('available')
    setUpdateSettings({ autoCheck: true, autoInstall: true }) // downloads in the background
    await vi.waitFor(() => expect(updateStatus().state).toBe('error'))
    expect(updateStatus().error).toBe('Файл обновления повреждён, попробуйте ещё раз')

    served = { manifest: signedBy(keys.privateKey), exe }
    setUpdateSettings({ autoInstall: false })
    expect((await checkForUpdateNow()).outcome).toBe('available')
    setUpdateSettings({ autoInstall: true })
    await vi.waitFor(() => expect(updateStatus()).toMatchObject({ state: 'available', ready: true }))
  })
})

describe('the downloaded exe is checked again right before the swap (L2)', () => {
  it('fileMatches: exact size and SHA-256 only', async () => {
    const { writeFileSync } = await import('node:fs')
    const { fileMatches } = await import('./appUpdate')
    const file = join(dir, 'check.update')
    writeFileSync(file, exe)
    expect(fileMatches(file, fields.size, fields.sha256)).toBe(true)
    writeFileSync(file, Buffer.from('MZ swapped by something else'))
    expect(fileMatches(file, fields.size, fields.sha256)).toBe(false)
    writeFileSync(file, Buffer.concat([exe, Buffer.from('x')]))
    expect(fileMatches(file, fields.size, fields.sha256)).toBe(false)
    expect(fileMatches(join(dir, 'missing.update'), fields.size, fields.sha256)).toBe(false)
  })
})
