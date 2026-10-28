// @vitest-environment node
import { createHash, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// «Автообновление» while the app is open (owner, 17.10.2026: «обновлялось в реальном времени, не закрывая приложение»).
const keys = await vi.hoisted(async () => {
  const { generateKeyPairSync } = await import('node:crypto')
  const pair = generateKeyPairSync('ed25519')
  return { privateKey: pair.privateKey, publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
})
const env = vi.hoisted(() => ({ dir: '', raid: false, idle: false, quit: vi.fn(), spawn: vi.fn(() => ({ unref: vi.fn() })) }))
vi.mock('electron', () => ({ app: { isPackaged: true, on: vi.fn(), quit: env.quit, getPath: () => env.dir }, shell: { openExternal: vi.fn() } }))
vi.mock('node:child_process', () => ({ spawn: env.spawn }))
vi.mock('./updateSigningKey.js', () => ({ UPDATE_SIGNING_PUBLIC_KEY: keys.publicPem }))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => false, buildDefaultServerUrl: () => 'https://raidos.app' }))
vi.mock('./localServer.js', () => ({ runningBuild: async () => ({ version: '0.6.0', build: 100, commit: 'old', trialLaunches: 0, edition: 'client' }) }))
vi.mock('./serviceGateway.js', () => ({ loadServerUrl: async () => '', apiBaseUrl: () => '', ownerExeManifest: async () => null, ownerExeLink: async () => { throw new Error('no owner exe') } }))
// The Electron side of the parts (electron/deltaUpdate.ts) is mocked: appDelta.test.ts covers staging and classification.
const delta = vi.hoisted(() => ({
  fetchDeltaInfo: vi.fn(),
  stageDeltaUpdate: vi.fn(),
  activateDeltaUpdate: vi.fn(),
  relaunchWhenClosed: vi.fn(),
  classifyStagedUpdate: vi.fn(),
  liveRendererIndex: vi.fn(),
  markStagedBuildBad: vi.fn(),
  stagedBuildBad: vi.fn(),
}))
vi.mock('./deltaUpdate.js', () => delta)

const { canonicalUpdatePayload } = await import('./updateManifest')
const exe = Buffer.from('MZ whole exe')
let release: { build: number; version: string }
const manifest = () => {
  const fields = { edition: 'client' as const, version: release.version, build: release.build, commit: `c${release.build}`, size: exe.length, sha256: createHash('sha256').update(exe).digest('hex') }
  return { ...fields, signature: sign(null, Buffer.from(canonicalUpdatePayload(fields)), keys.privateKey).toString('base64') }
}
const infoOf = (build: number, version: string) => ({ format: 1, build, version, commit: `c${build}`, electron: '44.4.5', asar: { size: 10, dataStart: 16, sha256: 'a'.repeat(64), headerSha256: 'b'.repeat(64) }, resources: {} })
const fetchMock = vi.fn(async (url: string) => new URL(url).pathname === '/download/version.json' ? new Response(JSON.stringify(manifest())) : new Response(new Uint8Array(exe)))
const INDEX = 'C:\\Users\\Игрок\\AppData\\Roaming\\Raid OS Updates\\client\\200\\app.asar\\dist\\index.html'
const applyLive = vi.fn<(index: string) => Promise<boolean | null>>()

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  env.dir = mkdtempSync(join(tmpdir(), 'raidos-live-'))
  process.env.PORTABLE_EXECUTABLE_FILE = join(env.dir, 'Raid OS.exe')
  env.raid = false
  env.idle = false
  release = { build: 100, version: '0.6.0' }
  vi.stubGlobal('fetch', fetchMock)
  delta.fetchDeltaInfo.mockImplementation(async (_base: string, signed: { build: number; version: string }) => infoOf(signed.build, signed.version))
  delta.stageDeltaUpdate.mockResolvedValue({ downloaded: 10, total: 100, archive: 'x' })
  delta.classifyStagedUpdate.mockReturnValue('renderer')
  delta.liveRendererIndex.mockReturnValue(INDEX)
  delta.stagedBuildBad.mockReturnValue(false)
  applyLive.mockResolvedValue(true)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  rmSync(env.dir, { recursive: true, force: true })
  delete process.env.PORTABLE_EXECUTABLE_FILE
})

/** Starts with nothing new, then the release `build` is published and the 5-minute check finds it. */
async function publishedWhileOpen(build = 200, version = '0.6.1', autoInstall = true) {
  const updater = await import('./appUpdate')
  updater.setUpdateSettings({ autoCheck: true, autoInstall })
  updater.startUpdateChecks(() => {}, { inRaid: async () => env.raid, applyLive, windowIdle: () => env.idle })
  await vi.advanceTimersByTimeAsync(3000)
  expect(updater.updateStatus().state).toBe('idle')
  release = { build, version }
  await vi.advanceTimersByTimeAsync(5 * 60_000)
  return updater
}

describe('a release that changes only the page', () => {
  it('is staged in the background and loaded into the window once it is not in use and no raid is on', async () => {
    const updater = await publishedWhileOpen()
    expect(delta.stageDeltaUpdate).toHaveBeenCalledOnce()
    expect(updater.updateStatus()).toMatchObject({ state: 'available', ready: true })
    // In use: it waits.
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(applyLive).not.toHaveBeenCalled()
    // Not in use but a raid is on: it waits.
    env.idle = true
    env.raid = true
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(applyLive).not.toHaveBeenCalled()
    // After the raid, a minute of not being used, then the page.
    env.raid = false
    await vi.advanceTimersByTimeAsync(30_000)
    expect(applyLive).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(applyLive).toHaveBeenCalledExactlyOnceWith(INDEX)
    // The next start runs that build in full; the page shows the new version; nothing restarts.
    expect(delta.activateDeltaUpdate).toHaveBeenCalledExactlyOnceWith(infoOf(200, '0.6.1'))
    expect(updater.updateStatus()).toMatchObject({ state: 'idle', liveVersion: '0.6.1' })
    expect(await updater.rendererVersion()).toBe('0.6.1')
    expect(delta.relaunchWhenClosed).not.toHaveBeenCalled()
    expect(env.quit).not.toHaveBeenCalled()
    expect(env.spawn).not.toHaveBeenCalled()
  })

  it('the build already in the window is not offered again; a later release still is', async () => {
    const updater = await publishedWhileOpen()
    env.idle = true
    await vi.advanceTimersByTimeAsync(90_000)
    expect(applyLive).toHaveBeenCalledOnce()
    expect((await updater.checkForUpdateNow())).toMatchObject({ outcome: 'latest', current: '0.6.1' })
    expect(updater.updateStatus().liveVersion).toBe('0.6.1')
    release = { build: 300, version: '0.6.2' }
    expect((await updater.checkForUpdateNow()).outcome).toBe('available')
  })

  it('a page that fails goes back (main.ts) and is marked bad: never loaded, staged or started again by itself', async () => {
    applyLive.mockResolvedValue(false)
    const updater = await publishedWhileOpen()
    env.idle = true
    await vi.advanceTimersByTimeAsync(90_000)
    expect(applyLive).toHaveBeenCalledOnce()
    expect(delta.markStagedBuildBad).toHaveBeenCalledExactlyOnceWith(200)
    expect(delta.activateDeltaUpdate).not.toHaveBeenCalled()
    expect(updater.updateStatus()).toMatchObject({ state: 'available', version: '0.6.1' })
    expect(updater.updateStatus().liveVersion).toBeUndefined()
    expect(await updater.rendererVersion()).toBe('0.6.0')
    delta.stagedBuildBad.mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(applyLive).toHaveBeenCalledOnce()
    expect(delta.stageDeltaUpdate).toHaveBeenCalledOnce()
    expect(env.quit).not.toHaveBeenCalled()
  })

  it('a staged build that no longer verifies is never loaded and is marked bad', async () => {
    delta.liveRendererIndex.mockReturnValue('')
    await publishedWhileOpen()
    env.idle = true
    await vi.advanceTimersByTimeAsync(90_000)
    expect(applyLive).not.toHaveBeenCalled()
    expect(delta.markStagedBuildBad).toHaveBeenCalledWith(200)
  })

  it('not tried by main.ts (no window, a file the IPC guard does not trust): it waits for the next start', async () => {
    applyLive.mockResolvedValue(null)
    const updater = await publishedWhileOpen()
    env.idle = true
    await vi.advanceTimersByTimeAsync(90_000)
    expect(delta.activateDeltaUpdate).toHaveBeenCalledOnce()
    expect(delta.markStagedBuildBad).not.toHaveBeenCalled()
    expect(updater.updateStatus()).toMatchObject({ state: 'available', ready: true, nextStart: true })
  })

  it('switched off meanwhile: it is not loaded', async () => {
    const updater = await publishedWhileOpen()
    updater.setUpdateSettings({ autoInstall: false })
    env.idle = true
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(applyLive).not.toHaveBeenCalled()
  })

  it('a newer release replaces one still waiting for the window', async () => {
    const updater = await publishedWhileOpen()
    delta.classifyStagedUpdate.mockReturnValue('restart')
    release = { build: 300, version: '0.6.2' }
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(updater.updateStatus()).toMatchObject({ state: 'available', version: '0.6.2', nextStart: true })
    env.idle = true
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(applyLive).not.toHaveBeenCalled()
    expect(delta.activateDeltaUpdate).toHaveBeenCalledExactlyOnceWith(infoOf(300, '0.6.2'))
  })
})

describe('any other release while the app is open', () => {
  it('is staged in the background for the next start; the window is never switched and the app never restarts', async () => {
    delta.classifyStagedUpdate.mockReturnValue('restart')
    const updater = await publishedWhileOpen()
    expect(delta.activateDeltaUpdate).toHaveBeenCalledExactlyOnceWith(infoOf(200, '0.6.1'))
    expect(updater.updateStatus()).toMatchObject({ state: 'available', ready: true, nextStart: true })
    env.idle = true
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(applyLive).not.toHaveBeenCalled()
    expect(delta.stageDeltaUpdate).toHaveBeenCalledOnce()
    expect(delta.relaunchWhenClosed).not.toHaveBeenCalled()
    expect(env.quit).not.toHaveBeenCalled()
  })

  it('keeps the build whose page the window shows when it switches the next start to a later one', async () => {
    const updater = await publishedWhileOpen()
    env.idle = true
    await vi.advanceTimersByTimeAsync(90_000)
    expect(updater.updateStatus().liveVersion).toBe('0.6.1')
    delta.classifyStagedUpdate.mockReturnValue('restart')
    release = { build: 300, version: '0.6.2' }
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(delta.activateDeltaUpdate).toHaveBeenLastCalledWith(infoOf(300, '0.6.2'), [200])
    expect(updater.updateStatus()).toMatchObject({ state: 'available', version: '0.6.2', nextStart: true, liveVersion: '0.6.1' })
  })

  it('nothing is downloaded during a raid, a bad build is never staged by itself, and without «Автообновление» it is downloaded but never switched on by itself', async () => {
    env.raid = true
    const inRaid = await publishedWhileOpen()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(delta.stageDeltaUpdate).not.toHaveBeenCalled()
    expect(inRaid.updateStatus().state).toBe('available')

    vi.clearAllTimers()
    vi.resetModules()
    env.raid = false
    release = { build: 100, version: '0.6.0' }
    delta.stagedBuildBad.mockReturnValue(true)
    const bad = await publishedWhileOpen()
    expect(delta.stageDeltaUpdate).not.toHaveBeenCalled()
    expect(bad.updateStatus()).toMatchObject({ state: 'available' })
    // Its startup installation is skipped too; «Обновить» by hand still puts it in.
    await bad.installUpdate()
    expect(delta.relaunchWhenClosed).not.toHaveBeenCalled()

    vi.clearAllTimers()
    vi.resetModules()
    release = { build: 100, version: '0.6.0' }
    delta.stagedBuildBad.mockReturnValue(false)
    const manual = await publishedWhileOpen(200, '0.6.1', false)
    // Owner, 29.10.2026: downloaded in the background, installed only by «Установить обновление».
    await vi.waitFor(() => expect(manual.updateStatus()).toMatchObject({ state: 'available', ready: true }))
    expect(delta.stageDeltaUpdate).toHaveBeenCalledOnce()
    expect(delta.activateDeltaUpdate).not.toHaveBeenCalled()
    expect(manual.updateStatus().nextStart).toBeUndefined()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(delta.activateDeltaUpdate).not.toHaveBeenCalled()
    expect(delta.relaunchWhenClosed).not.toHaveBeenCalled()
  })
})
