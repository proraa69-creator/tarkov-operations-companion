// @vitest-environment node
import { createHash, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ dir: '', raid: false, quit: vi.fn(), spawn: vi.fn(() => ({ unref: vi.fn() })) }))
const keys = await vi.hoisted(async () => {
  const { generateKeyPairSync } = await import('node:crypto')
  const pair = generateKeyPairSync('ed25519')
  return { privateKey: pair.privateKey, publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
})
vi.mock('electron', () => ({ app: { isPackaged: true, on: vi.fn(), quit: env.quit, getPath: () => env.dir } }))
vi.mock('node:child_process', () => ({ spawn: env.spawn }))
vi.mock('node:os', () => ({ tmpdir: () => env.dir }))
vi.mock('./updateSigningKey.js', () => ({ UPDATE_SIGNING_PUBLIC_KEY: keys.publicPem }))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => false, buildDefaultServerUrl: () => 'https://raidos.app' }))
vi.mock('./localServer.js', () => ({ runningBuild: async () => ({ version: '0.5.4', build: 100, edition: 'client' }) }))
vi.mock('./serviceGateway.js', () => ({ loadServerUrl: async () => '', apiBaseUrl: () => '' }))

const realOs = await vi.importActual<typeof import('node:os')>('node:os')
const bytes = Buffer.from('MZ verified update')
let remoteBuild: number
let raidOnDownload: boolean
let interrupted: boolean
const fetchMock = vi.fn(async (url: string) => {
  if (url.includes('/download/version.json')) {
    const { canonicalUpdatePayload } = await import('./updateManifest')
    const fields = { edition: 'client' as const, version: '0.5.4', build: remoteBuild, commit: 'new', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    return new Response(JSON.stringify({ ...fields, signature: sign(null, Buffer.from(canonicalUpdatePayload(fields)), keys.privateKey).toString('base64') }))
  }
  if (raidOnDownload) env.raid = true
  if (interrupted) return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(bytes.subarray(0, 4))) },
    pull(controller) { controller.error(new Error('Connection interrupted')) },
  }))
  return new Response(new Uint8Array(bytes))
})

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  env.dir = mkdtempSync(join(realOs.tmpdir(), 'raidos-update-policy-'))
  process.env.PORTABLE_EXECUTABLE_FILE = join(env.dir, 'Raid OS.exe')
  env.raid = false
  env.quit.mockClear()
  env.spawn.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  remoteBuild = 200
  raidOnDownload = false
  interrupted = false
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  for (const file of readdirSync(env.dir)) unlinkSync(join(env.dir, file))
  rmdirSync(env.dir)
  delete process.env.PORTABLE_EXECUTABLE_FILE
  vi.unstubAllGlobals()
})
async function launch(autoCheck = true, autoInstall = true) {
  const updater = await import('./appUpdate')
  updater.setUpdateSettings({ autoCheck, autoInstall })
  updater.startUpdateChecks(() => {}, { inRaid: async () => env.raid })
  await vi.advanceTimersByTimeAsync(3000)
  return updater
}
const downloads = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/download/windows')).length

describe('desktop update policy', () => {
  it('downloads, verifies and restarts once at startup, including with notifications off', async () => {
    const updater = await launch(false, true)
    await vi.waitFor(() => expect(updater.updateStatus().state).toBe('installing'))
    expect(downloads()).toBe(1)
    expect(env.quit).toHaveBeenCalledOnce()
    expect(env.spawn).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ windowsHide: true }))
  })
  it('with automatic installation off only offers the header button', async () => {
    const updater = await launch(true, false)
    expect(updater.updateStatus()).toMatchObject({ state: 'available', notify: true })
    expect(downloads()).toBe(0)
    expect(env.quit).not.toHaveBeenCalled()
  })
  it('an update published later is offered but never downloaded automatically', async () => {
    remoteBuild = 100
    const updater = await launch()
    expect(updater.updateStatus().state).toBe('idle')
    remoteBuild = 300
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(updater.updateStatus().state).toBe('available')
    updater.setUpdateSettings({ autoInstall: true })
    expect(downloads()).toBe(0)
    expect(env.quit).not.toHaveBeenCalled()
  })
  it('a startup during a raid never downloads, including after the raid ends', async () => {
    env.raid = true
    const updater = await launch()
    env.raid = false
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(updater.updateStatus().state).toBe('available')
    expect(downloads()).toBe(0)
  })
  it('a raid starting during download blocks the swap and requires a manual retry', async () => {
    raidOnDownload = true
    const updater = await launch()
    await vi.waitFor(() => expect(updater.updateStatus()).toMatchObject({ state: 'available', ready: true, blockedByRaid: true }))
    expect(env.spawn).not.toHaveBeenCalled()
    expect(env.quit).not.toHaveBeenCalled()
    env.raid = false
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(env.spawn).not.toHaveBeenCalled()
    raidOnDownload = false
    await updater.installUpdate()
    expect(env.spawn).toHaveBeenCalledOnce()
    expect(downloads()).toBe(1)
  })
  it('an installation the player did not press waits in a raid', async () => {
    const updater = await launch(true, false)
    env.raid = true
    await updater.installUpdate()
    expect(updater.updateStatus().blockedByRaid).toBe(true)
    expect(downloads()).toBe(0)
    expect(env.quit).not.toHaveBeenCalled()
  })
  it('«Обновить» pressed by the player installs even when the logs say a raid is on', async () => {
    const updater = await launch(true, false)
    env.raid = true
    await updater.installUpdate({ manual: true })
    expect(updater.updateStatus().blockedByRaid).toBeUndefined()
    expect(downloads()).toBe(1)
    expect(env.spawn).toHaveBeenCalledOnce()
    expect(env.quit).toHaveBeenCalled()
  })
  it('an interrupted download leaves no partial file or restart and can be retried', async () => {
    const updater = await launch(true, false)
    interrupted = true
    await updater.installUpdate()
    expect(updater.updateStatus().state).toBe('error')
    expect(existsSync(`${process.env.PORTABLE_EXECUTABLE_FILE}.update`)).toBe(false)
    expect(env.quit).not.toHaveBeenCalled()
    interrupted = false
    await updater.installUpdate()
    expect(updater.updateStatus().state).toBe('installing')
    expect(env.quit).toHaveBeenCalledOnce()
  })
})
