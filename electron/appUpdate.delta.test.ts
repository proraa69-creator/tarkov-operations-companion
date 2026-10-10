// @vitest-environment node
import { createHash, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

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
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }))
// The owner's partial update (electron/ownerDelta.ts): the published parts are mocked here, appDelta.test.ts covers them.
const delta = vi.hoisted(() => ({ info: null as unknown, fetchDeltaInfo: vi.fn(), stageOwnerDelta: vi.fn(async () => ({ downloaded: 10, total: 100 })), activateOwnerDelta: vi.fn(), relaunchWhenClosed: vi.fn() }))
vi.mock('./ownerDelta.js', () => ({ fetchDeltaInfo: delta.fetchDeltaInfo, stageOwnerDelta: delta.stageOwnerDelta, activateOwnerDelta: delta.activateOwnerDelta, relaunchWhenClosed: delta.relaunchWhenClosed }))

const { canonicalUpdatePayload } = await import('./updateManifest')
const { checkForUpdateNow, installUpdate, startUpdateChecks, updateStatus } = await import('./appUpdate')

const dir = mkdtempSync(join(tmpdir(), 'raidos-update-'))
build.userData = dir
process.env.PORTABLE_EXECUTABLE_FILE = join(dir, 'Raid OS.exe')
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.PORTABLE_EXECUTABLE_FILE })

const exe = Buffer.from('MZ new players build')
const fields = { edition: 'client' as const, version: '0.5.4', build: 200, commit: 'abc1234', size: exe.length, sha256: createHash('sha256').update(exe).digest('hex') }
const signedBy = (key: typeof keys.privateKey, manifest: typeof fields | { edition: 'owner' | 'client'; version: string; build: number; commit: string; size: number; sha256: string } = fields) =>
  ({ ...manifest, signature: sign(null, Buffer.from(canonicalUpdatePayload(manifest), 'utf8'), key).toString('base64') })

let served: { manifest: unknown; exe: Buffer }
const fetchMock = vi.fn(async (url: string) => new URL(url).pathname === '/download/version.json'
  ? new Response(JSON.stringify(served.manifest), { headers: { 'content-type': 'application/json' } })
  : new Response(new Uint8Array(served.exe)))
vi.stubGlobal('fetch', fetchMock)
startUpdateChecks(() => {})


describe('the owner\'s partial update (electron/ownerDelta.ts)', () => {
  it('the owner copy takes the players\' release in parts when it is published, and only then (owner, 10.10.2026)', async () => {
    build.owner = true
    served = { manifest: signedBy(keys.privateKey), exe }
    delta.fetchDeltaInfo.mockResolvedValueOnce(null)
    expect((await checkForUpdateNow()).outcome).toBe('latest')
    const info = { format: 1, build: 200, version: '0.5.4', commit: 'abc1234', electron: '44.4.5', asar: { size: 10, dataStart: 16 }, resources: {} }
    delta.fetchDeltaInfo.mockResolvedValue(info)
    expect((await checkForUpdateNow()).outcome).toBe('available')
    expect(delta.fetchDeltaInfo).toHaveBeenLastCalledWith('https://typed-in.example', expect.objectContaining({ build: 200, version: '0.5.4', commit: 'abc1234' }))
    await installUpdate({ manual: true })
    expect(delta.stageOwnerDelta).toHaveBeenCalledWith('https://typed-in.example', info, expect.any(Function))
    expect(delta.activateOwnerDelta).toHaveBeenCalledWith(info)
    expect(delta.relaunchWhenClosed).toHaveBeenCalledWith(process.env.PORTABLE_EXECUTABLE_FILE)
    expect(updateStatus()).toMatchObject({ state: 'installing', progress: 100 })
    // The whole exe was never downloaded.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/download/windows'))).toBe(false)
  })

})
