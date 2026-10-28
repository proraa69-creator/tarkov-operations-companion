import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, shell } from 'electron'
import { buildDefaultServerUrl, isOwnerBuild } from './buildEdition.js'
import { runningBuild } from './localServer.js'
import { apiBaseUrl, loadServerUrl, ownerExeLink, ownerExeManifest } from './serviceGateway.js'
import { verifiedUpdateManifest } from './updateManifest.js'
import type { DeltaInfo } from './appDelta.js'
import { activateDeltaUpdate, classifyStagedUpdate, fetchDeltaInfo, liveRendererIndex, markStagedBuildBad, relaunchWhenClosed, stagedBuildBad, stageDeltaUpdate } from './deltaUpdate.js'

/**
 * «Автообновление» (owner, 17.10.2026: «обновление приложения в фоновом режиме… не закрывая приложение… главное, чтобы
 * не было проблем с работоспособностью»): at startup it installs at once as before (restart within seconds of the
 * launch); while the app is open a newer release is downloaded and checked in the background and
 *  - a build that changes only the page (electron/appDelta.ts classifyStagedBuild) is loaded into the open window when
 *    it is not in use — the main process and preload stay, settings and progress (localStorage / IndexedDB of file://)
 *    stay — and starts in full next time; a page that fails to load goes back to the old one and is never tried again;
 *  - anything else waits for the next start (a staged build is started by electron/boot.ts, the whole exe by the
 *    startup installation). The open app never restarts by itself and nothing is installed on close.
 * Never in a raid: the raid gate is asked before the download and again before the page is switched.
 *
 * Without «Автообновление» (owner, 29.10.2026: «приложение должно автоматически начать скачиваться при выходе обновления,
 * но устанавливается по нажатию… «Установить обновление»»): a new release is still downloaded and checked in the
 * background, but nothing is switched — neither into the window nor for the next start; «Установить обновление» in the
 * top bar installs what was downloaded (installUpdate reuses it) and restarts.
 */
export type UpdateState = 'idle' | 'available' | 'downloading' | 'installing' | 'error'
/**
 * ready: verified download retained when a raid blocked installation. ownerExe: the owner's copy, a release only a whole
 * owner exe brings, and no signed manifest of that exe on the server — the fallback: «Скачать новую версию» opens the
 * admin panel. With a signed manifest the owner's copy installs that exe here instead (a normal «Обновить приложение»).
 */
/**
 * nextStart: downloaded in the background and starts with the next launch («Обновление скачано — применится при следующем
 * запуске»). liveVersion: the open window was switched to this version without a restart (the page shows it once).
 */
export interface UpdateStatus { state: UpdateState; version?: string; commit?: string; progress?: number; error?: string; ready?: boolean; phase?: 'verifying'; background?: boolean; notify?: boolean; blockedByRaid?: boolean; ownerExe?: boolean; nextStart?: boolean; liveVersion?: string }
// Preserve the existing persisted keys: autoCheck controls notifications, autoInstall «Автообновление» (startup and background).
export interface UpdateSettings { autoCheck: boolean; autoInstall: boolean }
/**
 * Result of a check by hand: what the settings line says. unsigned: the server's build has no valid signature (not
 * offered). owner-exe: the owner's copy, a release that cannot come in parts and no signed owner exe on the server —
 * the owner downloads the whole owner exe in the admin panel.
 */
export type UpdateCheckOutcome = 'available' | 'latest' | 'offline' | 'unsigned' | 'no-server' | 'not-portable' | 'disabled' | 'busy' | 'owner-exe'
export interface UpdateCheckResult { outcome: UpdateCheckOutcome; status: UpdateStatus; current: string; checkedAt: string }

/**
 * delta: the release in parts (electron/deltaUpdate.ts) instead of a whole exe. deltaOnly: the owner's copy, whose
 * edition has no whole exe on the site (it hands out the players' one); a player's copy falls back to the whole exe.
 * owner: the owner's copy and a release with another Electron or other files outside the archive — parts cannot bring
 * it, so the whole owner exe comes from the owner-only route (server/src/routes/serverDownload.ts); version, build,
 * size and SHA-256 are those of its own signed manifest (edition 'owner'), downloaded, checked and swapped in exactly
 * like the players' exe. ownerExe: the same release while the server has no such signed manifest — the owner
 * downloads it in the admin panel («Серверная версия») as before.
 */
interface Remote { version: string; build: number; commit: string; size: number; sha256: string; delta?: DeltaInfo; deltaOnly?: boolean; ownerExe?: boolean; owner?: boolean }

const CHECK_DELAY_MS = 3_000
const CHECK_EVERY_MS = 5 * 60_000
/** A staged page waits until the window is not in use; asked this often. */
const LIVE_CHECK_EVERY_MS = 15_000
/** ...and for this long in a row (a quick alt-tab to the game is not «not in use»). */
const LIVE_IDLE_GRACE_MS = 60_000
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
/** A release whose parts failed once in this session: a player's copy takes its whole exe from then on. */
let deltaFailedBuild: number | null = null
/** The build whose page the window shows after a live update (the main process still runs its own build-info.json). */
let live: { build: number; version: string; commit: string } | null = null
/** A staged page-only release waiting for the window to be unused. */
let pendingLive: { target: Remote; delta: DeltaInfo } | null = null
/** A release downloaded in the background for the next start (a staged build, or the whole exe next to this one). */
let nextStartBuild: number | null = null
let background: Promise<void> | null = null
/** A background download of this release failed: the next launch tries again (or «Обновить» now). */
let backgroundFailedBuild: number | null = null
let liveTimer: NodeJS.Timeout | null = null
let idleSince = 0
let applying = false
/**
 * main.ts: load a verified staged page into the window. true: it works; false: it failed and the old page is back;
 * null: not tried (no window, or the file is not one the IPC guard may trust) — the build then waits for the next start.
 */
let applyLive: ((indexFile: string) => Promise<boolean | null>) | null = null
/** main.ts: the window is not in use (minimized, hidden, not focused, or no input for a while). */
let windowIdle: () => boolean = () => false

function set(next: UpdateStatus) {
  status = { ...next, notify: updateSettings().autoCheck, ...(live ? { liveVersion: live.version } : {}) }
  notify(status)
}

/** The version the window shows (app:version): after a live update that of the page, not of the main process. */
export async function rendererVersion() {
  return live?.version ?? (await runningBuild()).version
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
  // After a live update the page is already that build: it is not offered again.
  const localBuild = Math.max(local.build, live?.build ?? 0)
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
    if (signed.build <= localBuild) { remote = null; if (status.state === 'available') set({ state: 'idle' }); return 'latest' }
    // A player's copy takes the release in parts too (owner, 11.10.2026), but only when the release signed its partial
    // update with the update key; otherwise, and after a failed attempt, the whole exe as before.
    let wholeExe = false
    const delta = ownerDelta || deltaFailedBuild !== signed.build ? await fetchDeltaInfo(base, signed, { signed: !ownerDelta, onWholeExe: () => { wholeExe = true } }) : null
    // The owner's copy: no parts published (yet) — nothing to offer; parts that cannot bring this release — say so.
    if (ownerDelta && !delta && !wholeExe) return 'latest'
    // Parts cannot bring it: the whole owner exe when the server has its signed manifest (installed here like the
    // players' exe), otherwise the admin panel as before.
    const ownerWhole = ownerDelta && !delta ? await signedOwnerExe(localBuild) : null
    const ownerExe = ownerDelta && !delta && !ownerWhole
    const next: Remote = ownerWhole
      ? { version: ownerWhole.version, build: ownerWhole.build, commit: ownerWhole.commit, size: ownerWhole.size, sha256: ownerWhole.sha256, owner: true }
      : { version: signed.version, build: signed.build, commit: signed.commit, size: signed.size, sha256: signed.sha256, ...(delta ? { delta, deltaOnly: ownerDelta } : {}), ...(ownerExe ? { ownerExe } : {}) }
    const known = remote?.build === next.build && status.state === 'available' && Boolean(status.ownerExe) === ownerExe
    remote = next
    source = base
    if (!known) set({ state: 'available', version: next.version, commit: next.commit, ...(ownerExe ? { ownerExe } : { ready: downloaded?.build === next.build || staged === next.build, ...(nextStartBuild === next.build && updateSettings().autoInstall ? { nextStart: true } : {}) }) })
    return ownerExe ? 'owner-exe' : 'available'
  } catch { return 'offline' } // server offline: try again later
}

/**
 * The owner's copy only: the whole owner exe's manifest from the owner-only route, when its signature verifies with the
 * update key built into the app, it is an owner build and newer than the running one; else null (the admin-panel
 * fallback). A player's copy never gets here and never asks that route.
 */
async function signedOwnerExe(localBuild: number) {
  if (!isOwnerBuild()) return null
  try {
    const manifest = verifiedUpdateManifest(await ownerExeManifest())
    return manifest?.edition === 'owner' && manifest.build > localBuild ? manifest : null
  } catch {
    return null
  }
}

export async function checkForUpdate() {
  await probe()
  return status
}

/** Settings → «Проверить обновление приложения». */
export async function checkForUpdateNow(): Promise<UpdateCheckResult> {
  const outcome = enabled ? await probe() : 'disabled'
  return { outcome, status, current: await rendererVersion(), checkedAt: new Date().toISOString() }
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
  if (!preferences.autoCheck && !preferences.autoInstall) return
  // A launch inside a raid never installs (and restarts) when that raid ends: later checks download in the background.
  const startupSafe = startup && !(await raidBlocksInstall())
  const outcome = await probe()
  if (outcome !== 'available') return
  const auto = updateSettings().autoInstall
  if (startupSafe && auto) await installUpdate()
  else if (!startup || !auto) await backgroundUpdate()
}

/**
 * «Автообновление» while the app is open: downloads and checks the release without restarting. Parts that change only
 * the page wait for the window to be unused (tryLiveUpdate); other parts are switched on for the next start; the whole
 * exe stays next to this one for the next start's installation. Not in a raid, not twice, not a build marked bad.
 */
function backgroundUpdate() {
  background ??= backgroundOnce().finally(() => { background = null })
  return background
}

async function backgroundOnce() {
  const target = remote
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!exe || !target || target.ownerExe || swapStarted || status.state === 'downloading' || status.state === 'installing') return
  if (backgroundFailedBuild === target.build || nextStartBuild === target.build || pendingLive?.target.build === target.build) return
  const parts = target.delta && deltaFailedBuild !== target.build ? target.delta : null
  // A build whose page failed in the window or whose start failed: only «Обновить» by hand puts it in again.
  if (parts && stagedBuildBad(parts.build)) return
  if (await raidBlocksInstall()) return
  const base = { version: target.version, commit: target.commit }
  const quiet = { background: true }
  set({ state: 'downloading', ...base, progress: 0, ...quiet })
  try {
    if (parts) {
      const delta = parts
      try {
        await stageInBackground(target, delta)
      } catch (error) {
        if (target.deltaOnly) throw error
        // A player's copy: the whole exe on the next check, as for «Обновить» (installUpdate).
        console.warn(`Raid OS: partial update failed in the background (${failure(error)})`)
        deltaFailedBuild = target.build
        if (remote?.build === target.build) remote = { ...remote, delta: undefined, deltaOnly: undefined }
        set({ state: 'available', ...base })
        return
      }
      // A newer release replaces one that still waits for the window (its staged files go with the next activation).
      pendingLive = null
      stopLiveWatch()
      if (applyLive && classifyStagedUpdate(delta) === 'renderer') {
        pendingLive = { target, delta }
        set({ state: 'available', ...base, ready: true })
        watchForLiveUpdate()
        return
      }
      // Switched on for the next start only with «Автообновление»; otherwise it waits for «Установить обновление».
      if (updateSettings().autoInstall) activate(delta)
    } else {
      const file = downloaded?.build === target.build && existsSync(downloaded.file) ? downloaded.file : keptDownload(exe, target) ?? await download(target, quiet)
      downloaded = { file, build: target.build, size: target.size, sha256: target.sha256 }
    }
    nextStartBuild = target.build
    set({ state: 'available', ...base, ready: true, ...(updateSettings().autoInstall ? { nextStart: true } : {}) })
  } catch (error) {
    // Not shown as an error (the player did not start it): offered by hand, tried again on the next launch.
    console.warn(`Raid OS: background update failed (${failure(error)})`)
    backgroundFailedBuild = target.build
    set({ state: 'available', ...base })
  }
}

async function stageInBackground(target: Remote, delta: DeltaInfo) {
  if (staged === target.build) return
  const base = { version: target.version, commit: target.commit }
  let lastShown = -1
  await stageDeltaUpdate(source, delta, (done, total) => {
    const progress = total ? Math.min(99, Math.floor(done / total * 100)) : 99
    if (progress !== lastShown) { lastShown = progress; set({ state: 'downloading', ...base, progress, background: true }) }
  })
  staged = target.build
}

/** The next start runs this staged build; the one whose page the window shows stays on disk. */
function activate(delta: DeltaInfo) {
  if (live && live.build !== delta.build) activateDeltaUpdate(delta, [live.build])
  else activateDeltaUpdate(delta)
}

function watchForLiveUpdate() {
  if (liveTimer) return
  idleSince = 0
  liveTimer = setInterval(() => void tryLiveUpdate(), LIVE_CHECK_EVERY_MS)
  liveTimer.unref?.()
}

function stopLiveWatch() {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null }
}

/**
 * The staged page goes into the window once it has not been in use for LIVE_IDLE_GRACE_MS, no raid is on (asked again
 * now) and «Автообновление» is still on. Success: the next start runs that build in full. Failure (main.ts went back to
 * the old page): the build is marked bad and offered only by hand.
 */
async function tryLiveUpdate(now = Date.now()) {
  const pending = pendingLive
  if (!pending || applying || swapStarted || !applyLive) return
  if (status.state === 'downloading' || status.state === 'installing') return
  if (!updateSettings().autoInstall) { idleSince = 0; return }
  let idle: boolean
  try { idle = windowIdle() } catch { idle = false }
  if (!idle) { idleSince = 0; return }
  if (!idleSince) idleSince = now
  if (now - idleSince < LIVE_IDLE_GRACE_MS) return
  applying = true
  try {
    if (await raidBlocksInstall()) { idleSince = 0; return }
    // Read again after the await: a newer release or «Обновить» may have replaced it.
    if (pendingLive !== pending || swapStarted) return
    const { target, delta } = pending
    const base = { version: target.version, commit: target.commit }
    pendingLive = null
    stopLiveWatch()
    const index = liveRendererIndex(delta)
    const ok = index ? await applyLive(index) : false
    if (ok === null) {
      try { activate(delta) } catch (error) { console.warn(`Raid OS: the staged build could not be set for the next start (${failure(error)})`); set({ state: 'available', ...base }); return }
      nextStartBuild = target.build
      set({ state: 'available', ...base, ready: true, nextStart: true })
      return
    }
    if (ok) {
      live = { build: target.build, version: target.version, commit: target.commit }
      try { activate(delta) } catch (error) { console.warn(`Raid OS: the live build could not be set for the next start (${failure(error)})`) }
      if (remote?.build === target.build) remote = null
      set({ state: 'idle' })
      return
    }
    // Never again by itself: neither loaded into the window nor started (electron/deltaBoot.ts).
    console.warn(`Raid OS: the page of build ${target.build} did not load, back to the running one`)
    markStagedBuildBad(target.build)
    backgroundFailedBuild = target.build
    set({ state: 'available', ...base })
  } finally {
    applying = false
  }
}

async function raidBlocksInstall() {
  try { return await inRaid() } catch { return true }
}

function schedule() {
  if (timer) { clearInterval(timer); timer = null }
  if (!enabled || !app.isPackaged || !(updateSettings().autoCheck || updateSettings().autoInstall)) return
  timer = setInterval(() => void automaticCheck(false), CHECK_EVERY_MS)
}

/**
 * `applyLive`: main.ts loads a verified staged page into the window and resolves whether it works (false: the old page
 * is back). `windowIdle`: the window is not in use. Without them a page-only release waits for the next start.
 */
export function startUpdateChecks(onStatus: (status: UpdateStatus) => void, options: { inRaid?: () => boolean | Promise<boolean>; applyLive?: (indexFile: string) => Promise<boolean | null>; windowIdle?: () => boolean } = {}) {
  notify = onStatus
  if (options.inRaid) inRaid = options.inRaid
  if (options.applyLive) applyLive = options.applyLive
  if (options.windowIdle) windowIdle = options.windowIdle
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
  let target = remote
  // The fallback: the server has no signed manifest of the owner's exe for this release, so it is only in the admin
  // panel («Серверная версия»). The owner's click checks once more (it may have been published meanwhile) and installs
  // it here if so; otherwise it opens the admin panel. Nothing happens without that click.
  if (target.ownerExe) {
    if (!options.manual) return status
    await probe()
    // Read again after the await: another click may have started meanwhile.
    const now = updateStatus()
    if (!remote || remote.ownerExe || swapStarted || now.state === 'downloading' || now.state === 'installing') {
      if (remote?.ownerExe && source.startsWith('https://')) void shell.openExternal(new URL('/admin', source).toString()).catch(() => {})
      return status
    }
    target = remote
  }
  // A build whose page or start failed (electron/deltaBoot.ts bad) is never put in again automatically, only by a click.
  if (!options.manual && target.delta && stagedBuildBad(target.build)) return status
  const base = { version: target.version, commit: target.commit }
  // Reserve the operation before awaiting the live raid check (prevents concurrent IPC clicks).
  set({ state: 'downloading', ...base, progress: 0 })
  try {
    if (await raidBlocks()) { set({ state: 'available', ...base, ready: downloaded?.build === target.build, blockedByRaid: true }); return status }
    if (target.delta) {
      try {
        return await installDelta(exe, target, target.delta, raidBlocks)
      } catch (error) {
        if (target.deltaOnly) throw error
        // A player's copy: a failed part (network, a release replaced meanwhile, a file that does not match) → the whole exe.
        console.warn(`Raid OS: partial update failed (${failure(error)}), downloading the whole exe`)
        swapStarted = false
        deltaFailedBuild = target.build
        if (remote?.build === target.build) remote = { ...remote, delta: undefined, deltaOnly: undefined }
      }
    }
    const file = downloaded?.build === target.build && existsSync(downloaded.file) ? downloaded.file : keptDownload(exe, target) ?? await download(target)
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

/** Staged partial update (electron/deltaUpdate.ts): the build already downloaded for this release. */
let staged: number | null = null

/**
 * Downloads only the changed files of the release, builds the new archive, then restarts the exe, which starts that
 * build (electron/boot.ts). A raid that began meanwhile keeps it staged for «Обновить» later.
 */
async function installDelta(exe: string, target: Remote, delta: DeltaInfo, raidBlocks: () => Promise<boolean>) {
  const base = { version: target.version, commit: target.commit }
  if (firstCheck) { clearTimeout(firstCheck); firstCheck = null }
  if (staged !== target.build) {
    let lastShown = -1
    await stageDeltaUpdate(source, delta, (done, total) => {
      const progress = total ? Math.min(99, Math.floor(done / total * 100)) : 99
      if (progress !== lastShown) { lastShown = progress; set({ state: 'downloading', ...base, progress }) }
    })
    staged = target.build
  }
  if (await raidBlocks()) { set({ state: 'available', ...base, ready: true, blockedByRaid: true }); return status }
  pendingLive = null
  stopLiveWatch()
  activate(delta)
  set({ state: 'installing', ...base, progress: 100 })
  swapStarted = true
  relaunchWhenClosed(exe)
  app.quit()
  return status
}

/**
 * Downloads the new exe next to this one and checks its size and SHA-256 (the signed values, see probe); returns the file.
 * The players' exe comes from the site; the owner's whole exe from a one-time link of the owner-only route, asked with
 * the owner's session (electron/serviceGateway.ts) on the same server.
 */
async function download(target: Remote, extra: Partial<UpdateStatus> = {}) {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!exe) throw new Error('Обновление доступно только для portable-версии')
  const partial = `${exe}.update`
  const base = { version: target.version, commit: target.commit, ...extra }
  if (firstCheck) { clearTimeout(firstCheck); firstCheck = null }
  set({ state: 'downloading', ...base, progress: 0 })
  try {
    let url = `${source}/download/windows`
    if (target.owner) {
      const link = await ownerExeLink()
      if (!link.url.startsWith(`${source}/`)) throw new Error('Сервер обновления сменился, проверьте обновление ещё раз')
      if (link.size !== target.size) throw new Error('На сервере уже другой выпуск, попробуйте ещё раз')
      url = link.url
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) })
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

/**
 * The whole exe a background download of an earlier session left next to this one (`<exe>.update`), when it is exactly
 * this release (the signed size and SHA-256): the next start installs it without downloading it again.
 */
function keptDownload(exe: string, target: Remote) {
  const file = `${exe}.update`
  return existsSync(file) && fileMatches(file, target.size, target.sha256) ? file : null
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
