import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import { buildDefaultServerUrl, isOwnerBuild } from './buildEdition.js'
import { runningBuild } from './localServer.js'
import { apiBaseUrl, loadServerUrl } from './serviceGateway.js'
import { verifiedUpdateManifest } from './updateManifest.js'
import type { DeltaInfo } from './appDelta.js'
import { activateOwnerDelta, fetchDeltaInfo, relaunchWhenClosed, stageOwnerDelta } from './ownerDelta.js'

// Automatic installation has exactly one opportunity per launch. Later checks only offer a manual update.
export type UpdateState = 'idle' | 'available' | 'downloading' | 'installing' | 'error'
/** ready: verified download retained when a raid blocked installation. */
export interface UpdateStatus { state: UpdateState; version?: string; commit?: string; progress?: number; error?: string; ready?: boolean; phase?: 'verifying'; background?: boolean; notify?: boolean; blockedByRaid?: boolean }
// Preserve the existing persisted keys: autoCheck now controls notifications, autoInstall is startup-only.
export interface UpdateSettings { autoCheck: boolean; autoInstall: boolean }
/** Result of a check by hand: what the settings line says. unsigned: the server's build has no valid signature (not offered). */
export type UpdateCheckOutcome = 'available' | 'latest' | 'offline' | 'unsigned' | 'no-server' | 'not-portable' | 'disabled' | 'busy'
export interface UpdateCheckResult { outcome: UpdateCheckOutcome; status: UpdateStatus; current: string; checkedAt: string }

/** delta: the owner's copy takes the players' release in parts (electron/ownerDelta.ts) instead of a whole exe. */
interface Remote { version: string; build: number; commit: string; size: number; sha256: string; delta?: DeltaInfo }

const CHECK_DELAY_MS = 3_000
const CHECK_EVERY_MS = 5 * 60_000
const DEFAULT_SETTINGS: UpdateSettings = { autoCheck: true, autoInstall: false }

let status: UpdateStatus = { state: 'idle' }
let remote: Remote | null = null
let source = ''
let notify: (status: UpdateStatus) => void = () => {}
let timer: NodeJS.Timeout | null = null
let firstCheck: NodeJS.Timeout | null = null
/** startUpdateChecks was called: a normal (not server, not test) copy of the app. */
let enabled = false
let inRaid: () => boolean | Promise<boolean> = () => false
let settings: UpdateSettings | null = null
/** A verified file retained for a later manual retry, never installed on close. */
let downloaded: { file: string; build: number; size: number; sha256: string } | null = null
let swapStarted = false
let startupConsumed = false
let checking: Promise<UpdateCheckOutcome> | null = null

function set(next: UpdateStatus) {
  status = { ...next, notify: updateSettings().autoCheck }
  notify(status)
}

export function updateStatus() {
  return status
}

/**
 * Where updates come from, or '' when there is nothing to update from. A player's copy (client build): only the server
 * built into it (build-info defaultServerUrl, HTTPS), never the address typed in the app, so another server cannot
 * offer it an exe. The owner's copy: the other computer's site (the public server address) as before; it never takes
 * the players' build anyway (see probe).
 */
async function updateSource() {
  if (!isOwnerBuild()) {
    const builtIn = buildDefaultServerUrl()
    return builtIn.startsWith('https://') ? builtIn : ''
  }
  await loadServerUrl()
  let base: URL
  try { base = new URL(apiBaseUrl()) } catch { return '' }
  if (['127.0.0.1', 'localhost'].includes(base.hostname)) return '' // this PC's own server runs this very exe
  return base.origin
}

async function probe(): Promise<UpdateCheckOutcome> {
  if (checking) return checking
  checking = probeOnce()
  try { return await checking } finally { checking = null }
}

async function probeOnce(): Promise<UpdateCheckOutcome> {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (status.state === 'downloading' || status.state === 'installing') return 'busy'
  if (!exe) return 'not-portable'
  const local = await runningBuild()
  const base = await updateSource()
  if (!base) return 'no-server'
  if (!local.build) return 'not-portable'
  try {
    const response = await fetch(`${base}/download/version.json?ts=${Date.now()}`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' }, cache: 'no-store' })
    if (!response.ok) return 'offline'
    // Only the copy whose signature verified is used from here on (its size and SHA-256 check the download).
    const signed = verifiedUpdateManifest(await response.json())
    if (!signed) return 'unsigned'
    // The site hands out the players' (client) exe: the owner's own app never replaces itself with it, but takes the
    // same release in parts and turns it into an owner build (electron/appDelta.ts).
    const ownerDelta = local.edition === 'owner' && signed.edition === 'client'
    if (signed.edition !== local.edition && !ownerDelta) return 'latest'
    if (signed.build <= local.build) { remote = null; if (status.state === 'available') set({ state: 'idle' }); return 'latest' }
    const delta = ownerDelta ? await fetchDeltaInfo(base, signed) : undefined
    if (ownerDelta && !delta) return 'latest'
    const known = remote?.build === signed.build && status.state === 'available'
    remote = { version: signed.version, build: signed.build, commit: signed.commit, size: signed.size, sha256: signed.sha256, ...(delta ? { delta } : {}) }
    source = base
    if (!known) set({ state: 'available', version: remote.version, commit: remote.commit, ready: downloaded?.build === remote.build || staged === remote.build })
    return 'available'
  } catch { return 'offline' } // server offline: try again later
}

export async function checkForUpdate() {
  await probe()
  return status
}

/** Settings → «Проверить обновление приложения». */
export async function checkForUpdateNow(): Promise<UpdateCheckResult> {
  const outcome = enabled ? await probe() : 'disabled'
  return { outcome, status, current: (await runningBuild()).version, checkedAt: new Date().toISOString() }
}

function settingsFile() {
  return join(app.getPath('userData'), 'update-settings.json')
}

export function updateSettings(): UpdateSettings {
  if (settings) return settings
  try {
    const saved = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<UpdateSettings>
    settings = { autoCheck: saved.autoCheck !== false, autoInstall: saved.autoInstall === true }
  } catch { settings = { ...DEFAULT_SETTINGS } }
  return settings
}

export function setUpdateSettings(patch: unknown): UpdateSettings {
  const input = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {}
  const next = { ...updateSettings() }
  if (typeof input.autoCheck === 'boolean') next.autoCheck = input.autoCheck
  if (typeof input.autoInstall === 'boolean') next.autoInstall = input.autoInstall
  settings = next
  try {
    mkdirSync(dirname(settingsFile()), { recursive: true })
    writeFileSync(settingsFile(), JSON.stringify(next))
  } catch { /* kept for this session */ }
  schedule()
  set(status)
  return next
}

async function automaticCheck(startup: boolean) {
  if (startup && startupConsumed) return
  if (startup) startupConsumed = true
  const preferences = updateSettings()
  if (!preferences.autoCheck && !(startup && preferences.autoInstall)) return
  // A launch inside a raid never queues an automatic installation for when that raid ends.
  const startupSafe = startup && !(await raidBlocksInstall())
  if (await probe() === 'available' && startupSafe && preferences.autoInstall && updateSettings().autoInstall) await installUpdate()
}

async function raidBlocksInstall() {
  try { return await inRaid() } catch { return true }
}

function schedule() {
  if (timer) { clearInterval(timer); timer = null }
  if (!enabled || !app.isPackaged || !updateSettings().autoCheck) return
  timer = setInterval(() => void automaticCheck(false), CHECK_EVERY_MS)
}

export function startUpdateChecks(onStatus: (status: UpdateStatus) => void, options: { inRaid?: () => boolean | Promise<boolean> } = {}) {
  notify = onStatus
  if (options.inRaid) inRaid = options.inRaid
  if (enabled) return
  enabled = true
  if (!app.isPackaged) return
  firstCheck = setTimeout(() => { firstCheck = null; void automaticCheck(true) }, CHECK_DELAY_MS)
  schedule()
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /EPERM|EACCES/.test(message) ? 'Нет доступа к папке с приложением: переместите exe, например, на рабочий стол' : message
}

/**
 * Downloads the new exe (unless «Автоустановка» already did), checks it and hands over to the helper that swaps the files;
 * the app then quits. An automatic installation waits while a raid is on; «Обновить» pressed by the player (`manual`)
 * installs at once — his choice, even if the logs say a raid is on (a game closed mid-raid leaves the logs «in raid»).
 */
export async function installUpdate(options: { manual?: boolean } = {}) {
  const raidBlocks = async () => !options.manual && await raidBlocksInstall()
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!exe || !remote || swapStarted || status.state === 'downloading' || status.state === 'installing') return status
  const target = remote
  const base = { version: target.version, commit: target.commit }
  // Reserve the operation before awaiting the live raid check (prevents concurrent IPC clicks).
  set({ state: 'downloading', ...base, progress: 0 })
  try {
    if (await raidBlocks()) { set({ state: 'available', ...base, ready: downloaded?.build === target.build, blockedByRaid: true }); return status }
    if (target.delta) return await installDelta(exe, target, target.delta, raidBlocks)
    const file = downloaded?.build === target.build && existsSync(downloaded.file) ? downloaded.file : await download(target)
    // The signed size and SHA-256 once more, right before the helper swaps the file in (it may have changed on disk).
    if (!fileMatches(file, target.size, target.sha256)) {
      await rm(file, { force: true }).catch(() => {})
      if (downloaded?.file === file) downloaded = null
      throw new Error('Файл обновления изменился после проверки, скачайте обновление ещё раз')
    }
    downloaded = { file, build: target.build, size: target.size, sha256: target.sha256 }
    if (await raidBlocks()) { set({ state: 'available', ...base, ready: true, blockedByRaid: true }); return status }
    set({ state: 'installing', ...base, progress: 100 })
    swapStarted = true
    startSwapHelper(exe, file, true)
    app.quit()
  } catch (error) {
    swapStarted = false
    set({ state: 'error', ...base, error: failure(error) })
  }
  return status
}

/** Staged partial update of the owner's copy (electron/ownerDelta.ts): the build already downloaded for this release. */
let staged: number | null = null

/**
 * The owner's copy: downloads only the changed files of the release, builds the new archive, then restarts the exe,
 * which starts that build (electron/boot.ts). A raid that began meanwhile keeps it staged for «Обновить» later.
 */
async function installDelta(exe: string, target: Remote, delta: DeltaInfo, raidBlocks: () => Promise<boolean>) {
  const base = { version: target.version, commit: target.commit }
  if (firstCheck) { clearTimeout(firstCheck); firstCheck = null }
  if (staged !== target.build) {
    let lastShown = -1
    await stageOwnerDelta(source, delta, (done, total) => {
      const progress = total ? Math.min(99, Math.floor(done / total * 100)) : 99
      if (progress !== lastShown) { lastShown = progress; set({ state: 'downloading', ...base, progress }) }
    })
    staged = target.build
  }
  if (await raidBlocks()) { set({ state: 'available', ...base, ready: true, blockedByRaid: true }); return status }
  set({ state: 'installing', ...base, progress: 100 })
  swapStarted = true
  activateOwnerDelta(delta)
  relaunchWhenClosed(exe)
  app.quit()
  return status
}

/** Downloads the new exe next to this one and checks its size and SHA-256 (the signed values, see probe); returns the file. */
async function download(target: Remote) {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!exe) throw new Error('Обновление доступно только для portable-версии')
  const partial = `${exe}.update`
  const base = { version: target.version, commit: target.commit }
  if (firstCheck) { clearTimeout(firstCheck); firstCheck = null }
  set({ state: 'downloading', ...base, progress: 0 })
  try {
    const response = await fetch(`${source}/download/windows`, { signal: AbortSignal.timeout(30 * 60_000) })
    if (!response.ok || !response.body) throw new Error(`Сервер не отдал файл: HTTP ${response.status}`)
    const hash = createHash('sha256')
    let received = 0, lastShown = 0
    // pipeline closes the writer even if the connection fails, allowing a clean retry on Windows.
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
      new Transform({ transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > target.size) { callback(new Error('Файл обновления повреждён, попробуйте ещё раз')); return }
        hash.update(chunk)
        const progress = Math.min(99, Math.floor(received / target.size * 100))
        if (progress !== lastShown) { lastShown = progress; set({ state: 'downloading', ...base, progress }) }
        callback(null, chunk)
      } }),
      createWriteStream(partial, { mode: 0o600 }),
    )
    set({ state: 'downloading', ...base, progress: 100, phase: 'verifying' })
    if (received !== target.size || hash.digest('hex') !== target.sha256) throw new Error('Файл обновления повреждён, попробуйте ещё раз')
    return partial
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {})
    if (downloaded?.file === partial) downloaded = null
    throw error
  }
}

/** True when `file` has exactly `size` bytes and this SHA-256 (synchronous: also used from the quit handler). */
export function fileMatches(file: string, size: number, sha256: string) {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let total = 0
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null)
      if (!read) break
      total += read
      if (total > size) return false
      hash.update(buffer.subarray(0, read))
    }
    return total === size && hash.digest('hex') === sha256
  } catch {
    return false
  } finally {
    if (fd !== null) try { closeSync(fd) } catch { /* already closed */ }
  }
}

/**
 * The portable exe stays locked until this copy and its launcher have quit, so a hidden cmd waits for that, moves the
 * new file over the old one and starts it (unless the update is put in on close). Paths travel in environment
 * variables: cmd reads them correctly even with non-Latin folder names, which a batch file's own text would garble.
 * Synchronous, so it also works from the quit handler.
 */
function startSwapHelper(exe: string, partial: string, relaunch: boolean) {
  const script = join(tmpdir(), `tarkov-operator-update-${process.pid}.cmd`)
  writeFileSync(script, [
    '@echo off',
    'timeout /t 2 /nobreak >nul',
    'set n=0',
    ':move',
    'move /y "%TO_NEW%" "%TO_EXE%" >nul 2>&1 && goto run',
    'set /a n+=1',
    'if %n% geq 60 goto run',
    'timeout /t 1 /nobreak >nul',
    'goto move',
    ':run',
    'if "%TO_RUN%"=="1" start "" "%TO_EXE%"',
    '(goto) 2>nul & del "%~f0"',
  ].join('\r\n'), 'utf8')
  if (!existsSync(script)) throw new Error('Не удалось подготовить обновление')
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', script], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, TO_NEW: partial, TO_EXE: exe, TO_RUN: relaunch ? '1' : '0' },
  })
  child.unref()
}
