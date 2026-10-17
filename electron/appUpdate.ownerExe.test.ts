// @vitest-environment node
import { createHash, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The owner's copy and a release parts cannot bring (another Electron, files outside the archive): the whole owner exe
 * from the owner-only route, checked against its own signed manifest and swapped in like the players' exe (owner,
 * 15.10.2026: «нужно что бы начиналось обновление внутри приложения»). Without a verified manifest: the admin panel.
 */
const keys = await vi.hoisted(async () => {
  const { generateKeyPairSync } = await import('node:crypto')
  const pair = generateKeyPairSync('ed25519')
  const stranger = generateKeyPairSync('ed25519')
  return { privateKey: pair.privateKey, strangerKey: stranger.privateKey, publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
})
const env = vi.hoisted(() => ({ dir: '', owner: true, packaged: false, raid: false, quit: vi.fn(), on: vi.fn(), spawn: vi.fn(() => ({ unref: vi.fn() })), openExternal: vi.fn(async () => {}) }))
const gateway = vi.hoisted(() => ({ manifest: vi.fn(async (): Promise<unknown> => null), link: vi.fn(async () => ({ url: '', size: 0 })) }))

vi.mock('./updateSigningKey.js', () => ({ UPDATE_SIGNING_PUBLIC_KEY: keys.publicPem }))
vi.mock('electron', () => ({ app: { get isPackaged() { return env.packaged }, on: env.on, quit: env.quit, getPath: () => env.dir }, shell: { openExternal: env.openExternal } }))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => env.owner, buildDefaultServerUrl: () => 'https://raidos.app' }))
vi.mock('./localServer.js', () => ({ runningBuild: async () => ({ version: '0.6.0', build: 100, commit: 'old', trialLaunches: 0, edition: env.owner ? 'owner' : 'client' }) }))
vi.mock('./serviceGateway.js', () => ({ loadServerUrl: async () => '', apiBaseUrl: () => 'https://raidos.app', ownerExeManifest: gateway.manifest, ownerExeLink: gateway.link }))
vi.mock('node:child_process', () => ({ spawn: env.spawn }))
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), tmpdir: () => env.dir }))
// The release's parts cannot bring it (another Electron): electron/deltaUpdate.ts reports that through onWholeExe.
const delta = vi.hoisted(() => ({ fetchDeltaInfo: vi.fn(async (_base: string, _release: unknown, options: { onWholeExe?: (reason: string) => void }) => { options.onWholeExe?.('Electron 44.4.5 → 45.0.0'); return null }) }))
vi.mock('./deltaUpdate.js', () => ({ fetchDeltaInfo: delta.fetchDeltaInfo, stageDeltaUpdate: vi.fn(), activateDeltaUpdate: vi.fn(), relaunchWhenClosed: vi.fn(), stagedBuildBad: () => false, classifyStagedUpdate: () => 'restart', liveRendererIndex: () => '', markStagedBuildBad: vi.fn() }))

const { canonicalUpdatePayload } = await import('./updateManifest')
type Fields = Parameters<typeof canonicalUpdatePayload>[0]
const signedBy = (fields: Fields, key = keys.privateKey) => ({ ...fields, signature: sign(null, Buffer.from(canonicalUpdatePayload(fields), 'utf8'), key).toString('base64') })
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

const clientExe = Buffer.from('MZ the players exe of the release')
const ownerBytes = Buffer.from('MZ the owner exe of the release, signed')
const clientRelease: Fields = { edition: 'client', version: '0.6.1', build: 200, commit: 'abc-production', size: clientExe.length, sha256: sha(clientExe) }
const ownerRelease: Fields = { edition: 'owner', version: '0.6.1', build: 250, commit: 'abc-production', size: ownerBytes.length, sha256: sha(ownerBytes) }
const LINK = `https://raidos.app/v1/server-exe/${'a'.repeat(48)}`

let served: { owner: Buffer; interrupted?: boolean }
const fetchMock = vi.fn(async (url: string) => {
  const path = new URL(url).pathname
  if (path === '/download/version.json') return new Response(JSON.stringify(signedBy(clientRelease)), { headers: { 'content-type': 'application/json' } })
  if (path.startsWith('/v1/server-exe/')) {
    if (served.interrupted) return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(served.owner.subarray(0, 4))) },
      pull(controller) { controller.error(new Error('Connection interrupted')) },
    }))
    return new Response(new Uint8Array(served.owner))
  }
  return new Response(new Uint8Array(clientExe))
})
const urls = () => fetchMock.mock.calls.map(([url]) => String(url))
const partial = () => `${process.env.PORTABLE_EXECUTABLE_FILE}.update`

let statuses: Array<Record<string, unknown>>
async function updater(options: { packaged?: boolean } = {}) {
  vi.resetModules()
  env.packaged = options.packaged ?? false
  const module = await import('./appUpdate')
  statuses = []
  module.startUpdateChecks((next) => { statuses.push({ ...next }) }, { inRaid: async () => env.raid })
  return module
}

beforeEach(() => {
  vi.useRealTimers()
  env.dir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'raidos-owner-exe-'))
  process.env.PORTABLE_EXECUTABLE_FILE = join(env.dir, 'Raid OS Server.exe')
  env.owner = true
  env.raid = false
  env.quit.mockClear(); env.on.mockClear(); env.spawn.mockClear(); env.openExternal.mockClear()
  fetchMock.mockClear()
  delta.fetchDeltaInfo.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  served = { owner: ownerBytes }
  gateway.manifest.mockReset().mockResolvedValue(signedBy(ownerRelease))
  gateway.link.mockReset().mockResolvedValue({ url: LINK, size: ownerBytes.length })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  rmSync(env.dir, { recursive: true, force: true })
  delete process.env.PORTABLE_EXECUTABLE_FILE
})

describe('the owner\'s whole exe, inside the app', () => {
  it('a verified owner manifest: «Обновить приложение» (no ownerExe), then download → verify → the same swap as the players\'', async () => {
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    expect((await checkForUpdateNow()).outcome).toBe('available')
    // The owner build's own signed values, not the players' release.
    expect(updateStatus()).toMatchObject({ state: 'available', version: '0.6.1', commit: 'abc-production' })
    expect(updateStatus().ownerExe).toBeUndefined()
    await installUpdate({ manual: true })
    expect(gateway.link).toHaveBeenCalledOnce()
    expect(urls()).toContain(LINK)
    expect(urls().some((url) => url.includes('/download/windows'))).toBe(false)
    // Progress, the verify phase, then the installation.
    expect(statuses.some((next) => next.state === 'downloading' && typeof next.progress === 'number' && next.progress > 0 && next.progress < 100)).toBe(true)
    expect(statuses.some((next) => next.state === 'downloading' && next.phase === 'verifying')).toBe(true)
    expect(updateStatus()).toMatchObject({ state: 'installing', progress: 100 })
    expect(env.spawn).toHaveBeenCalledOnce()
    expect(env.spawn).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ env: expect.objectContaining({ TO_NEW: partial(), TO_EXE: process.env.PORTABLE_EXECUTABLE_FILE, TO_RUN: '1' }) }))
    expect(env.quit).toHaveBeenCalledOnce()
    expect(env.openExternal).not.toHaveBeenCalled()
  })

  it('refuses a manifest with a wrong signature, of the client edition or not newer: the admin-panel fallback, nothing downloaded', async () => {
    for (const manifest of [
      signedBy(ownerRelease, keys.strangerKey),
      { ...signedBy(ownerRelease), sha256: 'f'.repeat(64) },
      { ...signedBy(ownerRelease), size: ownerBytes.length + 1 },
      signedBy({ ...ownerRelease, edition: 'client' }),
      signedBy({ ...ownerRelease, build: 100 }),
      null,
    ]) {
      gateway.manifest.mockResolvedValue(manifest)
      const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
      expect((await checkForUpdateNow()).outcome).toBe('owner-exe')
      expect(updateStatus()).toMatchObject({ state: 'available', ownerExe: true })
      await installUpdate({ manual: true })
      expect(env.openExternal).toHaveBeenLastCalledWith('https://raidos.app/admin')
      expect(gateway.link).not.toHaveBeenCalled()
      expect(env.spawn).not.toHaveBeenCalled()
      expect(urls().some((url) => url.includes('/v1/server-exe/') || url.includes('/download/windows'))).toBe(false)
    }
  })

  it('a download whose SHA-256 differs from the signed one: refused, error shown, nothing swapped, no partial file', async () => {
    served = { owner: Buffer.from('MZ the owner exe of the release, SWAPPD') } // same size, other bytes
    expect(served.owner.length).toBe(ownerBytes.length)
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    await checkForUpdateNow()
    await installUpdate({ manual: true })
    expect(updateStatus()).toMatchObject({ state: 'error', error: 'Файл обновления повреждён, попробуйте ещё раз' })
    expect(env.spawn).not.toHaveBeenCalled()
    expect(env.quit).not.toHaveBeenCalled()
    expect(existsSync(partial())).toBe(false)
  })

  it('a download of another size, or a link to a file of another size: refused before anything is swapped', async () => {
    served = { owner: Buffer.concat([ownerBytes, Buffer.from('extra')]) }
    const first = await updater()
    await first.checkForUpdateNow()
    await first.installUpdate({ manual: true })
    expect(first.updateStatus()).toMatchObject({ state: 'error', error: 'Файл обновления повреждён, попробуйте ещё раз' })
    expect(existsSync(partial())).toBe(false)

    served = { owner: ownerBytes }
    fetchMock.mockClear()
    gateway.link.mockResolvedValue({ url: LINK, size: ownerBytes.length + 5 })
    const second = await updater()
    await second.checkForUpdateNow()
    await second.installUpdate({ manual: true })
    expect(second.updateStatus()).toMatchObject({ state: 'error', error: 'На сервере уже другой выпуск, попробуйте ещё раз' })
    expect(urls()).not.toContain(LINK)

    gateway.link.mockResolvedValue({ url: `https://elsewhere.example/v1/server-exe/${'a'.repeat(48)}`, size: ownerBytes.length })
    const third = await updater()
    await third.checkForUpdateNow()
    await third.installUpdate({ manual: true })
    expect(third.updateStatus().state).toBe('error')
    expect(env.spawn).not.toHaveBeenCalled()
  })

  it('an interrupted download: «Повторить обновление» state, no partial file; the retry asks a new link and installs', async () => {
    served = { owner: ownerBytes, interrupted: true }
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    await checkForUpdateNow()
    await installUpdate({ manual: true })
    expect(updateStatus().state).toBe('error')
    expect(existsSync(partial())).toBe(false)
    expect(env.spawn).not.toHaveBeenCalled()
    served = { owner: ownerBytes }
    await installUpdate({ manual: true })
    expect(gateway.link).toHaveBeenCalledTimes(2)
    expect(updateStatus().state).toBe('installing')
    expect(env.spawn).toHaveBeenCalledOnce()
  })

  it('the file is checked again right before the swap: changed on disk after a raid kept it, it is refused', async () => {
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    await checkForUpdateNow()
    env.raid = true
    // An automatic installation waits in a raid (before the download).
    await installUpdate()
    expect(updateStatus()).toMatchObject({ state: 'available', blockedByRaid: true })
    expect(gateway.link).not.toHaveBeenCalled()
    // A raid starting during the download keeps the verified file for later.
    env.raid = false
    fetchMock.mockImplementationOnce(async () => { env.raid = true; return new Response(new Uint8Array(ownerBytes)) })
    await installUpdate()
    expect(updateStatus()).toMatchObject({ state: 'available', ready: true, blockedByRaid: true })
    expect(existsSync(partial())).toBe(true)
    expect(env.spawn).not.toHaveBeenCalled()
    // Something changes the kept file: the owner's click refuses it instead of swapping it in.
    writeFileSync(partial(), Buffer.from('MZ the owner exe of the release, SWAPPD'))
    await installUpdate({ manual: true })
    expect(updateStatus()).toMatchObject({ state: 'error', error: 'Файл обновления изменился после проверки, скачайте обновление ещё раз' })
    expect(existsSync(partial())).toBe(false)
    expect(env.spawn).not.toHaveBeenCalled()
  })

  it('no installation on close: the updater registers no quit handler and a kept download is never swapped by quitting', async () => {
    const { checkForUpdateNow, installUpdate } = await updater()
    await checkForUpdateNow()
    fetchMock.mockImplementationOnce(async () => { env.raid = true; return new Response(new Uint8Array(ownerBytes)) })
    await installUpdate()
    expect(existsSync(partial())).toBe(true)
    expect(env.on.mock.calls.map(([event]) => event)).not.toEqual(expect.arrayContaining([expect.stringMatching(/quit|close/)]))
    expect(env.spawn).not.toHaveBeenCalled()
  })

  it('startup auto-install: installs the verified owner exe once at startup, never when the launch is in a raid (then in the background for the next start, owner 17.10.2026)', async () => {
    vi.useFakeTimers()
    const startup = async (raid: boolean) => {
      env.raid = raid
      const module = await updater({ packaged: true })
      module.setUpdateSettings({ autoCheck: true, autoInstall: true })
      await vi.advanceTimersByTimeAsync(3000)
      return module
    }
    const inRaid = await startup(true)
    expect(inRaid.updateStatus()).toMatchObject({ state: 'available' })
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(gateway.link).not.toHaveBeenCalled()
    // After the raid: downloaded and checked in the background, never swapped in while the app is open.
    env.raid = false
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await vi.waitFor(() => expect(inRaid.updateStatus()).toMatchObject({ state: 'available', ready: true, nextStart: true }))
    expect(gateway.link).toHaveBeenCalledOnce()
    expect(env.spawn).not.toHaveBeenCalled()
    expect(env.quit).not.toHaveBeenCalled()

    // The next start installs that verified file without downloading it again.
    const calm = await startup(false)
    await vi.waitFor(() => expect(calm.updateStatus().state).toBe('installing'))
    expect(gateway.link).toHaveBeenCalledOnce()
    expect(env.spawn).toHaveBeenCalledOnce()
  })

  it('a click on the fallback checks again: an owner exe signed meanwhile is installed here instead of opening the browser', async () => {
    gateway.manifest.mockResolvedValue(null)
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    expect((await checkForUpdateNow()).outcome).toBe('owner-exe')
    gateway.manifest.mockResolvedValue(signedBy(ownerRelease))
    await installUpdate({ manual: true })
    expect(env.openExternal).not.toHaveBeenCalled()
    expect(updateStatus()).toMatchObject({ state: 'installing' })
    expect(env.spawn).toHaveBeenCalledOnce()
  })
})

describe('a player\'s copy', () => {
  it('never asks the owner route, also for a release parts cannot bring: the players\' signed exe as before', async () => {
    env.owner = false
    const { checkForUpdateNow, installUpdate, updateStatus } = await updater()
    expect((await checkForUpdateNow()).outcome).toBe('available')
    expect(updateStatus()).toMatchObject({ state: 'available', version: '0.6.1' })
    expect(updateStatus().ownerExe).toBeUndefined()
    await installUpdate({ manual: true })
    expect(gateway.manifest).not.toHaveBeenCalled()
    expect(gateway.link).not.toHaveBeenCalled()
    expect(urls().some((url) => url.includes('/v1/'))).toBe(false)
    expect(urls()).toContain('https://raidos.app/download/windows')
    expect(updateStatus().state).toBe('installing')
    expect(readdirSync(env.dir)).toContain('Raid OS Server.exe.update')
  })
})
