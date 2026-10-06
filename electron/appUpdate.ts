import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { app } from 'electron'
import { buildDefaultServerUrl, isOwnerBuild } from './buildEdition.js'
import { runningBuild } from './localServer.js'
import { apiBaseUrl, loadServerUrl } from './serviceGateway.js'
import { verifiedUpdateManifest } from './updateManifest.js'

/**
 * Auto-update from the owner's server: the server laptop's site hands out the players' (client) exe the owner
 * published next to it (/download/windows) and says which build that is (/download/version.json with `edition`,
 * electron/localServer.ts). Only an app of the same edition updates from it, and only when the manifest's Ed25519
 * signature (scripts/sign-client-release.mjs) verifies with the key built into the app (electron/updateManifest.ts).
 * A newer build is offered in the top bar; «Обновить» downloads it next to this exe, checks size and SHA-256 against the
 * signed values, then a small helper replaces the exe once this copy has quit and starts the new one. Only for the
 * portable exe: a player's copy updates from the server built into it (https://raidos.app), the owner's copy from the
 * other computer's server it uses (Profile → «Адрес сервера»); the server laptop itself is updated by
 * Server-Laptop-Setup.cmd.
 *
 * Settings → «Проверить обновление приложения» checks by hand (checkForUpdateNow). Two switches, kept in userData
 * (update-settings.json): «Автообновление» — look for a new build on start and every few hours; «Автоустановка» —
 * put it in by itself at a safe moment: right after the start-up check (the app restarts at once, never while a raid
 * is on), otherwise it is downloaded in the background and swapped in when the app is closed.
 */
export type UpdateState = 'idle' | 'available' | 'downloading' | 'installing' | 'error'
/**
 * ready: the new exe is already downloaded and checked (installed on close when «Автоустановка» is on).
 * phase: while downloading, 'verifying' once all bytes are in and the size / SHA-256 are being checked.
 * background: a download «Автоустановка» started by itself (the renderer keeps it in the top bar, no full-screen window).
 */
export interface UpdateStatus { state: UpdateState; version?: string; commit?: string; progress?: number; error?: string; ready?: boolean; phase?: 'verifying'; background?: boolean }
export interface UpdateSettings { autoCheck: boolean; autoInstall: boolean }
/** Result of a check by hand: what the settings line says. unsigned: the server's build has no valid signature (not offered). */
export type UpdateCheckOutcome = 'available' | 'latest' | 'offline' | 'unsigned' | 'no-server' | 'not-portable' | 'disabled' | 'busy'
export interface UpdateCheckResult { outcome: UpdateCheckOutcome; status: UpdateStatus; current: string; checkedAt: string }

interface Remote { version: string; build: number; commit: string; size: number; sha256: string }

const CHECK_DELAY_MS = 20_000
const CHECK_EVERY_MS = 6 * 60 * 60_000
const DEFAULT_SETTINGS: UpdateSettings = { autoCheck: true, autoInstall: false }

let status: UpdateStatus = { state: 'idle' }
let remote: Remote | null = null
let source = ''
let notify: (status: UpdateStatus) => void = () => {}
let timer: NodeJS.Timeout | null = null
let firstCheck: NodeJS.Timeout | null = null
/** startUpdateChecks was called: a normal (not server, not test) copy of the app. */
let enabled = false
let inRaid: () => boolean = () => false
let settings: UpdateSettings | null = null
/** The downloaded and checked exe waiting to be swapped in (auto-install on close). */
let downloaded: { file: string; build: number; size: number; sha256: string } | null = null
let swapStarted = false

function set(next: UpdateStatus) {
  status = next
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
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (status.state === 'downloading' || status.state === 'installing') return 'busy'
  if (!exe) return 'not-portable'
  const local = await runningBuild()
  const base = await updateSource()
  if (!base) return 'no-server'
  if (!local.build) return 'not-portable'
  try {
    const response = await fetch(`${base}/download/version.json`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } })
    if (!response.ok) return 'offline'
    // Only the copy whose signature verified is used from here on (its size and SHA-256 check the download).
    const signed = verifiedUpdateManifest(await response.json())
    if (!signed) return 'unsigned'
    // The site hands out the players' (client) exe: the owner's own app never replaces itself with it.
    if (signed.edition !== local.edition) return 'latest'
    if (signed.build <= local.build) { remote = null; if (status.state === 'available') set({ state: 'idle' }); return 'latest' }
    const known = remote?.build === signed.build && status.state === 'available'
    remote = { version: signed.version, build: signed.build, commit: signed.commit, size: signed.size, sha256: signed.sha256 }
    source = base
    if (!known) set({ state: 'available', version: remote.version, commit: remote.commit, ready: downloaded?.build === remote.build })
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
  if (next.autoInstall && status.state === 'available') void autoInstall(false)
  return next
}

/** A check made by the timer; with «Автоустановка» on, a found build is installed at a safe moment. */
async function automaticCheck(startup: boolean) {
  if (!updateSettings().autoCheck) return
  if (await probe() === 'available' && updateSettings().autoInstall) await autoInstall(startup)
}

async function autoInstall(startup: boolean) {
  if (!remote || status.state === 'downloading' || status.state === 'installing') return
  // just started and not in a raid: restart on the new version right away; otherwise download now, swap on close
  if (startup && !inRaid()) { await installUpdate(); return }
  if (downloaded?.build === remote.build && existsSync(downloaded.file)) return
  const target = remote
  try {
    const file = await download(target, true)
    downloaded = { file, build: target.build, size: target.size, sha256: target.sha256 }
    set({ state: 'available', version: target.version, commit: target.commit, ready: true })
  } catch (error) {
    set({ state: 'error', version: target.version, commit: target.commit, error: failure(error), background: true })
  }
}

function schedule() {
  if (timer) { clearInterval(timer); timer = null }
  if (!enabled || !app.isPackaged || !updateSettings().autoCheck) return
  timer = setInterval(() => void automaticCheck(false), CHECK_EVERY_MS)
}

export function startUpdateChecks(onStatus: (status: UpdateStatus) => void, options: { inRaid?: () => boolean } = {}) {
  notify = onStatus
  if (options.inRaid) inRaid = options.inRaid
  if (enabled) return
  enabled = true
  // «Автоустановка»: a build downloaded earlier in this session is swapped in once the app has quit (no restart).
  app.on('will-quit', () => {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE
    if (swapStarted || !exe || !downloaded || !updateSettings().autoInstall || !existsSync(downloaded.file)) return
    // Checked again right before the swap: the file next to the exe may have been replaced since it was downloaded.
    if (!fileMatches(downloaded.file, downloaded.size, downloaded.sha256)) { void rm(downloaded.file, { force: true }).catch(() => {}); downloaded = null; return }
    swapStarted = true
    try { startSwapHelper(exe, downloaded.file, false) } catch { /* the next start offers the update again */ }
  })
  if (!app.isPackaged) return
  if (updateSettings().autoCheck) firstCheck = setTimeout(() => { firstCheck = null; void automaticCheck(true) }, CHECK_DELAY_MS)
  schedule()
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /EPERM|EACCES/.test(message) ? 'Нет доступа к папке с приложением: переместите exe, например, на рабочий стол' : message
}

/** Downloads the new exe (unless «Автоустановка» already did), checks it and hands over to the helper that swaps the files; the app then quits. */
export async function installUpdate() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!exe || !remote || status.state === 'downloading' || status.state === 'installing') return status
  const target = remote
  const base = { version: target.version, commit: target.commit }
  try {
    const file = downloaded?.build === target.build && existsSync(downloaded.file) ? downloaded.file : await download(target)
    // The signed size and SHA-256 once more, right before the helper swaps the file in (it may have changed on disk).
    if (!fileMatches(file, target.size, target.sha256)) {
      await rm(file, { force: true }).catch(() => {})
      if (downloaded?.file === file) downloaded = null
      throw new Error('Файл обновления изменился после проверки, скачайте обновление ещё раз')
    }
    set({ state: 'installing', ...base, progress: 100 })
    swapStarted = true
    startSwapHelper(exe, file, true)
    setTimeout(() => app.quit(), 300)
  } catch (error) {
    swapStarted = false
    set({ state: 'error', ...base, error: failure(error) })
  }
  return status
}

/** Downloads the new exe next to this one and checks its size and SHA-256 (the signed values, see probe); returns the file. */
async function download(target: Remote, background = false) {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!exe) throw new Error('Обновление доступно только для portable-версии')
  const partial = `${exe}.update`
  const base = { version: target.version, commit: target.commit, ...(background ? { background } : {}) }
  if (firstCheck) { clearTimeout(firstCheck); firstCheck = null }
  set({ state: 'downloading', ...base, progress: 0 })
  try {
    const response = await fetch(`${source}/download/windows`, { signal: AbortSignal.timeout(30 * 60_000) })
    if (!response.ok || !response.body) throw new Error(`Сервер не отдал файл: HTTP ${response.status}`)
    const hash = createHash('sha256')
    let received = 0, lastShown = 0
    const out = createWriteStream(partial)
    const failed = new Promise<never>((_, reject) => out.once('error', reject))
    for await (const chunk of Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>)) {
      const buffer = chunk as Buffer
      hash.update(buffer)
      received += buffer.length
      if (!out.write(buffer)) await Promise.race([new Promise((resolve) => out.once('drain', resolve)), failed])
      const progress = Math.min(99, Math.floor(received / target.size * 100))
      if (progress !== lastShown) { lastShown = progress; set({ state: 'downloading', ...base, progress }) }
    }
    await Promise.race([new Promise<void>((resolve) => out.end(resolve)), failed])
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
