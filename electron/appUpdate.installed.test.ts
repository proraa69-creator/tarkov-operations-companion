// @vitest-environment node
import { createHash, sign } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The players' app installed by RaidOSSetup.exe (electron/appInstall.ts; owner, 03.11.2026: «сделай установочный файл…
 * после этого пусть обновляется частями, и запускается быстро») and the portable exe's offer of that installer.
 */
const keys = await vi.hoisted(async () => {
  const { generateKeyPairSync } = await import('node:crypto')
  const pair = generateKeyPairSync('ed25519')
  return { privateKey: pair.privateKey, publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
})
const env = vi.hoisted(() => ({ owner: false, packaged: false, userData: '', installed: null as string | null, quit: vi.fn() }))
vi.mock('./updateSigningKey.js', () => ({ UPDATE_SIGNING_PUBLIC_KEY: keys.publicPem }))
vi.mock('electron', () => ({ app: { get isPackaged() { return env.packaged }, on: vi.fn(), quit: env.quit, getPath: () => env.userData }, shell: { openExternal: vi.fn() } }))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => env.owner, buildDefaultServerUrl: () => 'https://raidos.app' }))
vi.mock('./localServer.js', () => ({ runningBuild: async () => ({ version: '0.5.3', build: 100, commit: 'old', trialLaunches: 0, edition: env.owner ? 'owner' : 'client' }) }))
vi.mock('./serviceGateway.js', () => ({ loadServerUrl: async () => '', apiBaseUrl: () => '', ownerExeManifest: async () => null, ownerExeLink: async () => { throw new Error('no owner exe') } }))
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }))
const delta = vi.hoisted(() => ({ fetchDeltaInfo: vi.fn(), stageDeltaUpdate: vi.fn(async () => ({ downloaded: 10, total: 100 })), activateDeltaUpdate: vi.fn(), relaunchWhenClosed: vi.fn() }))
vi.mock('./deltaUpdate.js', () => ({ fetchDeltaInfo: delta.fetchDeltaInfo, stageDeltaUpdate: delta.stageDeltaUpdate, activateDeltaUpdate: delta.activateDeltaUpdate, relaunchWhenClosed: delta.relaunchWhenClosed, stagedBuildBad: vi.fn(() => false), classifyStagedUpdate: vi.fn(() => 'restart'), liveRendererIndex: vi.fn(() => ''), markStagedBuildBad: vi.fn() }))
// Whether this copy is installed is told by the uninstaller next to its exe (appInstall.test.ts); here it is set.
const install = vi.hoisted(() => ({ runSetupWhenClosed: vi.fn(), openSetupForPortable: vi.fn() }))
vi.mock('./appInstall.js', async (original) => ({
  ...await original<typeof import('./appInstall')>(),
  installedExe: () => env.installed,
  updatableExe: () => process.env.PORTABLE_EXECUTABLE_FILE || env.installed,
  runSetupWhenClosed: install.runSetupWhenClosed,
  openSetupForPortable: install.openSetupForPortable,
}))

const { canonicalUpdatePayload, SETUP_PAYLOAD_PREFIX, UPDATE_PAYLOAD_PREFIX } = await import('./updateManifest')

const dir = mkdtempSync(join(tmpdir(), 'raidos-installed-'))
env.userData = dir
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const exeBytes = Buffer.from('MZ portable exe 0.5.4')
const setupBytes = Buffer.from('MZ RaidOSSetup 0.5.4 installer')
const fieldsOf = (bytes: Buffer, build = 200) => ({ edition: 'client' as const, version: '0.5.4', build, commit: 'abc1234', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
const signedWith = (prefix: string, fields: ReturnType<typeof fieldsOf>) => ({ ...fields, signature: sign(null, Buffer.from(canonicalUpdatePayload(fields, prefix), 'utf8'), keys.privateKey).toString('base64') })
const info = { format: 1, build: 200, version: '0.5.4', commit: 'abc1234', electron: '44.4.5', asar: { size: 10, dataStart: 16, sha256: 'a'.repeat(64), headerSha256: 'b'.repeat(64) }, resources: {} }

/** What the site serves: setup.json is null until the publisher publishes the installer. */
const site = { setup: null as unknown, setupBytes }
const fetchMock = vi.fn(async (url: string) => {
  const path = new URL(url).pathname
  if (path === '/download/version.json') return Response.json(signedWith(UPDATE_PAYLOAD_PREFIX, fieldsOf(exeBytes)))
  if (path === '/downloads/setup.json') return site.setup ? Response.json(site.setup) : new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
  if (path === '/downloads/RaidOSSetup.exe') return new Response(new Uint8Array(site.setupBytes))
  return new Response(new Uint8Array(exeBytes))
})
vi.stubGlobal('fetch', fetchMock)
const fetched = (path: string) => fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === path).length
const setupFile = () => join(dir, 'updates', 'RaidOSSetup.exe')

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
  rmSync(setupFile(), { force: true })
  env.owner = false
  env.packaged = false
  site.setup = signedWith(SETUP_PAYLOAD_PREFIX, fieldsOf(setupBytes))
  site.setupBytes = setupBytes
})

describe('a copy installed by RaidOSSetup.exe', () => {
  beforeEach(() => {
    delete process.env.PORTABLE_EXECUTABLE_FILE
    env.installed = 'C:\\Users\\Игрок\\AppData\\Local\\Programs\\Raid OS\\Raid OS.exe'
  })

  it('takes a release in parts and starts again once it has quit itself (no launcher to wait for)', async () => {
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    delta.fetchDeltaInfo.mockResolvedValue(info)
    expect((await checkForUpdateNow()).outcome).toBe('available')
    await installUpdate({ manual: true })
    expect(delta.activateDeltaUpdate).toHaveBeenCalledWith(info)
    expect(delta.relaunchWhenClosed).toHaveBeenCalledWith(env.installed, process.pid)
    expect(updateStatus()).toMatchObject({ state: 'installing', progress: 100 })
    expect(env.quit).toHaveBeenCalledOnce()
    expect(fetched('/download/windows')).toBe(0)
  })

  it('a release parts cannot bring comes as the installer of that release, put in silently once the app has quit', async () => {
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    delta.fetchDeltaInfo.mockResolvedValue(null)
    expect((await checkForUpdateNow()).outcome).toBe('available')
    await installUpdate({ manual: true })
    // Never the portable exe: an installed copy is never replaced by it.
    expect(fetched('/download/windows')).toBe(0)
    expect(fetched('/downloads/RaidOSSetup.exe')).toBe(1)
    expect(existsSync(setupFile())).toBe(true)
    expect(install.runSetupWhenClosed).toHaveBeenCalledWith(setupFile(), env.installed)
    expect(updateStatus()).toMatchObject({ state: 'installing' })
    expect(env.quit).toHaveBeenCalledOnce()
  })

  it('no installer of that very release (not published, another build, or the exe manifest in its place): nothing to install', async () => {
    delta.fetchDeltaInfo.mockResolvedValue(null)
    for (const setup of [null, signedWith(SETUP_PAYLOAD_PREFIX, fieldsOf(setupBytes, 150)), signedWith(UPDATE_PAYLOAD_PREFIX, fieldsOf(setupBytes))]) {
      site.setup = setup
      const { checkForUpdateNow, installUpdate } = await updater()
      expect((await checkForUpdateNow()).outcome).toBe('latest')
      await installUpdate({ manual: true })
    }
    expect(fetched('/download/windows')).toBe(0)
    expect(fetched('/downloads/RaidOSSetup.exe')).toBe(0)
    expect(install.runSetupWhenClosed).not.toHaveBeenCalled()
    expect(env.quit).not.toHaveBeenCalled()
  })

  it('an installer that does not match its signed SHA-256 is never run', async () => {
    site.setupBytes = Buffer.from('MZ RaidOSSetup 0.5.4 changed!')
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    delta.fetchDeltaInfo.mockResolvedValue(null)
    expect((await checkForUpdateNow()).outcome).toBe('available')
    await installUpdate({ manual: true })
    expect(updateStatus().state).toBe('error')
    expect(existsSync(setupFile())).toBe(false)
    expect(install.runSetupWhenClosed).not.toHaveBeenCalled()
    expect(env.quit).not.toHaveBeenCalled()
  })

  it('is never offered the installer', async () => {
    env.packaged = true
    const { installerOffer } = await import('./appUpdate')
    expect(await installerOffer()).toBeNull()
  })
})

describe('the portable exe: the installer once the site publishes it («Установить» / «Позже»)', () => {
  beforeEach(() => {
    process.env.PORTABLE_EXECUTABLE_FILE = join(dir, 'RaidOSClient.exe')
    env.installed = null
    env.packaged = true
  })
  afterAll(() => { delete process.env.PORTABLE_EXECUTABLE_FILE })

  it('offers it only when its manifest is signed as the installer, never to the owner\'s copy or a development run', async () => {
    const { installerOffer } = await import('./appUpdate')
    expect(await installerOffer()).toEqual({ version: '0.5.4', size: setupBytes.length })
    site.setup = null
    expect(await installerOffer()).toBeNull()
    site.setup = signedWith(UPDATE_PAYLOAD_PREFIX, fieldsOf(setupBytes))
    expect(await installerOffer()).toBeNull()
    site.setup = signedWith(SETUP_PAYLOAD_PREFIX, fieldsOf(setupBytes))
    env.owner = true
    expect(await installerOffer()).toBeNull()
    env.owner = false
    env.packaged = false
    expect(await installerOffer()).toBeNull()
  })

  it('«Установить»: downloads and checks the installer, opens it and quits, without the top bar\'s update window', async () => {
    const { installFromPortable } = await updater()
    const statuses: unknown[] = []
    const module = await import('./appUpdate')
    module.startUpdateChecks((status) => statuses.push(status))
    const result = await installFromPortable()
    expect(fetched('/downloads/RaidOSSetup.exe')).toBe(1)
    expect(install.openSetupForPortable).toHaveBeenCalledWith(setupFile())
    expect(env.quit).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ state: 'installing', background: true })
    expect(statuses.every((status) => (status as { background?: boolean }).background === true)).toBe(true)
  })

  it('a damaged installer or none published: the window gets the error, the top bar keeps its state, nothing is opened', async () => {
    const { installFromPortable, updateStatus } = await updater()
    site.setupBytes = Buffer.from('MZ RaidOSSetup 0.5.4 changed!')
    expect(await installFromPortable()).toMatchObject({ state: 'error' })
    expect(updateStatus().state).toBe('idle')
    site.setup = null
    expect(await installFromPortable()).toMatchObject({ state: 'error', error: 'Установщик пока недоступен, попробуйте позже' })
    expect(install.openSetupForPortable).not.toHaveBeenCalled()
    expect(env.quit).not.toHaveBeenCalled()
  })
})
