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
const shellMock = vi.hoisted(() => ({ openExternal: vi.fn(async () => {}) }))
vi.mock('electron', () => ({ app: { isPackaged: false, on: vi.fn(), quit: vi.fn(), getPath: () => build.userData }, shell: shellMock }))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => build.owner, buildDefaultServerUrl: () => build.defaultServer }))
vi.mock('./localServer.js', () => ({ runningBuild: async () => ({ version: '0.5.3', build: 100, commit: 'old', trialLaunches: 0, edition: build.owner ? 'owner' : 'client' }) }))
// The address typed in the app: a player's copy must never update from it.
vi.mock('./serviceGateway.js', () => ({ loadServerUrl: async () => 'https://typed-in.example', apiBaseUrl: () => 'https://typed-in.example', ownerExeManifest: async () => null, ownerExeLink: async () => { throw new Error('no owner exe') } }))
const child = vi.hoisted(() => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }))
vi.mock('node:child_process', () => ({ spawn: child.spawn }))
// The partial update (electron/deltaUpdate.ts): the published parts are mocked here, appDelta.test.ts covers them.
const delta = vi.hoisted(() => ({ fetchDeltaInfo: vi.fn(), stageDeltaUpdate: vi.fn(async () => ({ downloaded: 10, total: 100 })), activateDeltaUpdate: vi.fn(), relaunchWhenClosed: vi.fn() }))
vi.mock('./deltaUpdate.js', () => ({ fetchDeltaInfo: delta.fetchDeltaInfo, stageDeltaUpdate: delta.stageDeltaUpdate, activateDeltaUpdate: delta.activateDeltaUpdate, relaunchWhenClosed: delta.relaunchWhenClosed }))

const { canonicalUpdatePayload } = await import('./updateManifest')

const dir = mkdtempSync(join(tmpdir(), 'raidos-update-'))
build.userData = dir
process.env.PORTABLE_EXECUTABLE_FILE = join(dir, 'Raid OS.exe')
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.PORTABLE_EXECUTABLE_FILE })

const exe = Buffer.from('MZ new players build')
const fields = { edition: 'client' as const, version: '0.5.4', build: 200, commit: 'abc1234', size: exe.length, sha256: createHash('sha256').update(exe).digest('hex') }
const signed = { ...fields, signature: sign(null, Buffer.from(canonicalUpdatePayload(fields), 'utf8'), keys.privateKey).toString('base64') }
const info = { format: 1, build: 200, version: '0.5.4', commit: 'abc1234', electron: '44.4.5', asar: { size: 10, dataStart: 16, sha256: 'a'.repeat(64), headerSha256: 'b'.repeat(64) }, resources: {} }

const fetchMock = vi.fn(async (url: string) => new URL(url).pathname === '/download/version.json'
  ? new Response(JSON.stringify(signed), { headers: { 'content-type': 'application/json' } })
  : new Response(new Uint8Array(exe)))
vi.stubGlobal('fetch', fetchMock)
const wholeExeDownloaded = () => fetchMock.mock.calls.some(([url]) => String(url).includes('/download/windows'))

/** A fresh updater: it installs at most once per launch, so every test starts its own. */
async function updater() {
  vi.resetModules()
  const module = await import('./appUpdate')
  module.startUpdateChecks(() => {})
  return module
}

beforeEach(() => {
  vi.clearAllMocks()
  delta.fetchDeltaInfo.mockReset()
  delta.stageDeltaUpdate.mockReset().mockResolvedValue({ downloaded: 10, total: 100 })
})

describe('the owner\'s partial update (electron/deltaUpdate.ts)', () => {
  it('the owner copy takes the players\' release in parts when it is published, and only then (owner, 10.10.2026)', async () => {
    build.owner = true
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    delta.fetchDeltaInfo.mockResolvedValueOnce(null)
    expect((await checkForUpdateNow()).outcome).toBe('latest')
    delta.fetchDeltaInfo.mockResolvedValue(info)
    expect((await checkForUpdateNow()).outcome).toBe('available')
    // Its own server's release, no signature needed: it turns the players' archive into an owner build.
    expect(delta.fetchDeltaInfo).toHaveBeenLastCalledWith('https://typed-in.example', expect.objectContaining({ build: 200, version: '0.5.4', commit: 'abc1234' }), expect.objectContaining({ signed: false }))
    await installUpdate({ manual: true })
    expect(delta.stageDeltaUpdate).toHaveBeenCalledWith('https://typed-in.example', info, expect.any(Function))
    expect(delta.activateDeltaUpdate).toHaveBeenCalledWith(info)
    expect(delta.relaunchWhenClosed).toHaveBeenCalledWith(process.env.PORTABLE_EXECUTABLE_FILE)
    expect(updateStatus()).toMatchObject({ state: 'installing', progress: 100 })
    // The whole exe was never downloaded.
    expect(wholeExeDownloaded()).toBe(false)
  })

  it('a release parts cannot bring (another Electron): the owner copy says so, and only the owner\'s click opens the admin panel (owner, 13.10.2026)', async () => {
    build.owner = true
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    const electronChanged = async (_base: string, _release: unknown, options: { onWholeExe?: (reason: string) => void }) => { options.onWholeExe?.('Electron 44.4.5 → 45.0.0'); return null }
    delta.fetchDeltaInfo.mockImplementation(electronChanged)
    expect((await checkForUpdateNow()).outcome).toBe('owner-exe')
    expect(updateStatus()).toMatchObject({ state: 'available', version: '0.5.4', ownerExe: true })
    // An automatic installation never opens a browser by itself.
    await installUpdate()
    expect(shellMock.openExternal).not.toHaveBeenCalled()
    // «Скачать новую версию»: the admin panel, where «Серверная версия» hands out the owner's exe; nothing is swapped here.
    await installUpdate({ manual: true })
    expect(shellMock.openExternal).toHaveBeenCalledWith('https://typed-in.example/admin')
    expect(updateStatus()).toMatchObject({ state: 'available', ownerExe: true })
    expect(delta.stageDeltaUpdate).not.toHaveBeenCalled()
    expect(wholeExeDownloaded()).toBe(false)
    expect(child.spawn).not.toHaveBeenCalled()
    // A later release that parts can bring again is a normal update.
    delta.fetchDeltaInfo.mockReset().mockResolvedValue(info)
    expect((await checkForUpdateNow()).outcome).toBe('available')
    expect(updateStatus().ownerExe).toBeUndefined()
  })

  it('a failed part stops the owner\'s update: the players\' whole exe is never put in its place', async () => {
    build.owner = true
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    delta.fetchDeltaInfo.mockResolvedValue(info)
    delta.stageDeltaUpdate.mockRejectedValue(new Error('Сервер не отдал часть обновления: HTTP 500'))
    expect((await checkForUpdateNow()).outcome).toBe('available')
    await installUpdate({ manual: true })
    expect(updateStatus()).toMatchObject({ state: 'error', error: 'Сервер не отдал часть обновления: HTTP 500' })
    expect(wholeExeDownloaded()).toBe(false)
    expect(child.spawn).not.toHaveBeenCalled()
  })
})

describe('a player\'s partial update (owner, 11.10.2026: «частичное обновление для клиентского приложения»)', () => {
  it('takes a release whose partial update is signed: only the changed files, then a restart into it', async () => {
    build.owner = false
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    delta.fetchDeltaInfo.mockResolvedValue(info)
    expect((await checkForUpdateNow()).outcome).toBe('available')
    // From the server built into the copy, and only with the update key's signature.
    expect(delta.fetchDeltaInfo).toHaveBeenLastCalledWith('https://raidos.app', expect.objectContaining({ build: 200 }), expect.objectContaining({ signed: true }))
    await installUpdate({ manual: true })
    expect(delta.stageDeltaUpdate).toHaveBeenCalledWith('https://raidos.app', info, expect.any(Function))
    expect(delta.activateDeltaUpdate).toHaveBeenCalledWith(info)
    expect(delta.relaunchWhenClosed).toHaveBeenCalledWith(process.env.PORTABLE_EXECUTABLE_FILE)
    expect(updateStatus()).toMatchObject({ state: 'installing', progress: 100 })
    expect(wholeExeDownloaded()).toBe(false)
  })

  it('without a signed partial update takes the whole exe as before', async () => {
    build.owner = false
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    delta.fetchDeltaInfo.mockResolvedValue(null)
    expect((await checkForUpdateNow()).outcome).toBe('available')
    await installUpdate({ manual: true })
    expect(delta.stageDeltaUpdate).not.toHaveBeenCalled()
    expect(wholeExeDownloaded()).toBe(true)
    expect(child.spawn).toHaveBeenCalledTimes(1)
    expect(updateStatus()).toMatchObject({ state: 'installing' })
  })

  it('a release parts cannot bring is the signed whole exe for a player, as before', async () => {
    build.owner = false
    const { checkForUpdateNow, updateStatus } = await updater()
    delta.fetchDeltaInfo.mockImplementation(async (_base: string, _release: unknown, options: { onWholeExe?: (reason: string) => void }) => { options.onWholeExe?.('Electron 44.4.5 → 45.0.0'); return null })
    expect((await checkForUpdateNow()).outcome).toBe('available')
    expect(updateStatus()).toMatchObject({ state: 'available', version: '0.5.4' })
    expect(updateStatus().ownerExe).toBeUndefined()
  })

  it('falls back to the whole exe when a part fails, and does not try the parts of that release again', async () => {
    build.owner = false
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    delta.fetchDeltaInfo.mockResolvedValue(info)
    delta.stageDeltaUpdate.mockRejectedValue(new Error('Файл dist/index.html не совпадает с обновлением'))
    expect((await checkForUpdateNow()).outcome).toBe('available')
    await installUpdate({ manual: true })
    expect(delta.activateDeltaUpdate).not.toHaveBeenCalled()
    expect(wholeExeDownloaded()).toBe(true)
    expect(child.spawn).toHaveBeenCalledTimes(1)
    expect(updateStatus()).toMatchObject({ state: 'installing' })
    delta.fetchDeltaInfo.mockClear()
    await checkForUpdateNow()
    expect(delta.fetchDeltaInfo).not.toHaveBeenCalled()
  })
})
