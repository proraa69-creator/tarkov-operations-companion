import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { appendFile, copyFile, mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { isOwnerBuild } from './buildEdition.js'
import { apiHealth, clientPublishDir, isServerMode, LOCAL_PORTS, runningBuild, serverDataDir } from './localServer.js'
import { sanitize, type ErrorEvent } from './errorReport.js'
import {
  CHECK_EVERY_MS, DEFAULT_RELEASES_REPO, encodedCommand, fileDigest, GitHubReleaseSource, HEALTH_REASON_TEXT, HEALTH_RULES, healthVerdict, helperEnvironment, helperLogTail,
  helperScript, installWindowOf, launcherScript, READY_FOR_INSTALL_TEXT, REPO_PATTERN, ServerSelfUpdater, type BuildRef, type HealthReason, type HealthState,
  type HelperFailure, type InstallWindow, type StagedRelease, type UpdaterStatus,
} from './serverSelfUpdate.js'

/**
 * «Автообновление сервера» on the server laptop (owner build, --server-mode, portable exe on Windows): every 15 minutes
 * the app reads latest.json of the owner's private releases repository and, for a newer signed build, downloads,
 * verifies (electron/serverSelfUpdate.ts, key built into the app), publishes the players' version, keeps the running
 * exe as `previous`, and lets a small PowerShell helper swap the exe and restart with the same flags once this copy has
 * quit. The new build must be healthy (API /health with its build number + the site) within 2 minutes, otherwise the
 * helper restores `previous` (and the previous players' version) and starts it. On the next start the app records the
 * outcome in the history, the watchdog journal, a Windows notification, the admin panel («Обновление») and — for a
 * rollback — the GitHub error reports.
 *
 * Settings («Автообновление сервера» in the owner panel): repository, a fine-grained token with «Contents: Read-only»
 * on that repository only (encrypted with safeStorage, write-only), on/off, install mode: «вручную» (the default: the
 * laptop downloads and verifies, notifies the owner and waits for «Установить сейчас»), any time, or 03:00–06:00.
 * The website can only read the status and ask for «Проверить сейчас» / «Установить сейчас» / «Откатить на предыдущую»
 * (server/src/routes/selfUpdate.ts → electron/apiChannel.ts); it can never hand the laptop a file.
 *
 * Diagnostics: the helper logs every step to self-update\update-helper.log. Before quitting, the app waits until the
 * helper has really started (helper.pid); if it has not, the restart is cancelled and the server keeps running. On
 * start, a pending restart whose helper is gone without a final result is recorded as 'helper-lost' with the log tail.
 */

export interface HistoryEntry {
  at: string; kind: 'update' | 'rollback'; from: BuildRef; to: BuildRef; result: 'ok' | 'rolled-back' | 'failed'; reason?: string
  /** Code of a failure (HEALTH_REASON_TEXT keys, e.g. 'helper-lost'). */
  code?: string
  /** Sanitized tail of update-helper.log for a failure. */
  log?: string
}
interface PreviousExe extends BuildRef { size: number; sha256: string; savedAt: string; client: boolean }
interface Meta { skipped: number[]; previous?: PreviousExe; readyNotified?: number }
/** helper: 2 = the helper with helper.pid and update-helper.log (older pending restarts have none). */
interface PendingRestart { id: string; kind: 'update' | 'rollback'; from: BuildRef; to: BuildRef; startedAt: string; deadlineAt: string; helper?: number }
interface HelperResult { phase: 'checking' | 'ok' | 'rolling-back' | 'rolled-back' | 'failed'; reason?: string; detail?: string; build?: number; at?: string }

export interface SelfUpdateSettings { enabled: boolean; repo: string; window: InstallWindow; hasToken: boolean }
export interface SelfUpdateView extends SelfUpdateSettings {
  /** Why updates cannot be installed on this PC ('' when they can): not the server laptop, not portable, not Windows. */
  unsupported: string
  current: BuildRef
  previous: (BuildRef & { savedAt: string }) | null
  updater: UpdaterStatus
  /** The downloaded and verified build waiting for «Установить сейчас» (or the night window); null = none. */
  ready: BuildRef | null
  restart: { kind: 'update' | 'rollback'; from: BuildRef; to: BuildRef; startedAt: string; deadlineAt: string; phase: string } | null
  history: HistoryEntry[]
  skipped: number[]
  nextCheckAt?: string
}

export interface SelfUpdateHooks {
  journal: (level: 'info' | 'warn' | 'error', text: string) => void
  notify: (title: string, body: string, silent?: boolean) => void
  report: (event: ErrorEvent) => void
}

const TOKEN = /^github_pat_[A-Za-z0-9_]{20,255}$/
const FIRST_CHECK_MS = 2 * 60_000

const settingsFile = () => join(app.getPath('userData'), 'server-update.json')
const tokenFile = () => join(app.getPath('userData'), 'server-update-token.bin')
const stateDir = () => join(serverDataDir(), 'self-update')
const metaFile = () => join(stateDir(), 'meta.json')
const pendingFile = () => join(stateDir(), 'state.json')
const resultFile = () => join(stateDir(), 'result.json')
const confirmFile = () => join(stateDir(), 'confirm.json')
const historyFile = () => join(stateDir(), 'history.json')
const helperFile = () => join(stateDir(), 'update-helper.ps1')
const helperLogFile = () => join(stateDir(), 'update-helper.log')
const helperPidFile = () => join(stateDir(), 'helper.pid')
const appPidFile = () => join(stateDir(), 'app.pid')
/** How long the app waits for the helper to write helper.pid before it cancels the restart and stays up. */
const HELPER_START_TIMEOUT_MS = 40_000
/** How long the «does PowerShell start at all» probe may take before it is reported as hanging. */
const PROBE_TIMEOUT_MS = 30_000
/** The helper writes a log line at least every ~15 s while it works; older than this and no pid = gone. */
const HELPER_SILENT_MS = 90_000

let hooks: SelfUpdateHooks = { journal: () => {}, notify: () => {}, report: () => {} }
let updater: ServerSelfUpdater | null = null
let timer: NodeJS.Timeout | null = null
let nextCheckAt: number | undefined
let swapping = false
let lastJournaled: string | undefined

const readJson = <T>(file: string): T | null => {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as T } catch { return null }
}
const writeJson = async (file: string, data: unknown) => { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data, null, 1)) }
const ref = (build: { version: string; build: number; commit: string }): BuildRef => ({ version: build.version, build: build.build, commit: build.commit })

function savedSettings(): { enabled?: boolean; repo?: string; window?: InstallWindow } {
  return readJson(settingsFile()) ?? {}
}

/** Settings saved before the install mode existed (or without an explicit choice) mean 'manual'. */
export function selfUpdateSettings(): SelfUpdateSettings {
  const saved = savedSettings()
  return { enabled: saved.enabled === true, repo: saved.repo || DEFAULT_RELEASES_REPO, window: installWindowOf(saved.window), hasToken: existsSync(tokenFile()) }
}

export async function setSelfUpdateSettings(raw: unknown) {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const next = { ...savedSettings() }
  if (typeof input.enabled === 'boolean') next.enabled = input.enabled
  if (input.window === 'manual' || input.window === 'any' || input.window === 'night') next.window = input.window
  if (typeof input.repo === 'string') {
    const repo = input.repo.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '')
    if (!REPO_PATTERN.test(repo)) throw new Error('Репозиторий укажите как владелец/имя, например proraa69-creator/raidos-releases')
    next.repo = repo
  }
  if (input.clearToken === true) await rm(tokenFile(), { force: true })
  else if (typeof input.token === 'string' && input.token.trim()) {
    const value = input.token.trim()
    if (!TOKEN.test(value)) throw new Error('Нужен fine-grained токен GitHub: он начинается с github_pat_ (Settings → Developer settings → Fine-grained tokens)')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows не даёт зашифровать токен на этом компьютере')
    await writeFile(tokenFile(), safeStorage.encryptString(value))
  }
  if (next.enabled && !existsSync(tokenFile())) throw new Error('Сначала вставьте токен GitHub')
  await writeJson(settingsFile(), next)
  if (next.enabled) void theUpdater().check()
  return selfUpdateSettings()
}

async function source() {
  const settings = selfUpdateSettings()
  if (!settings.hasToken) return null
  let secret: string
  try { secret = safeStorage.decryptString(await readFile(tokenFile())) } catch { return null }
  return secret ? new GitHubReleaseSource({ repo: settings.repo, token: secret, userAgent: `RaidOS-server-updater/${app.getVersion()}` }) : null
}

function meta(): Meta {
  const saved = readJson<Meta>(metaFile())
  return {
    skipped: Array.isArray(saved?.skipped) ? saved.skipped.filter((build) => Number.isSafeInteger(build)).slice(-20) : [],
    ...(saved?.previous ? { previous: saved.previous } : {}),
    ...(Number.isSafeInteger(saved?.readyNotified) ? { readyNotified: saved!.readyNotified } : {}),
  }
}

function history(): HistoryEntry[] {
  const saved = readJson<HistoryEntry[]>(historyFile())
  return Array.isArray(saved) ? saved.slice(0, 30) : []
}

/** Why this copy cannot swap its own exe ('' = it can). */
function unsupported() {
  if (!isOwnerBuild()) return 'Только в версии владельца.'
  if (!isServerMode()) return 'Только на ноутбуке-сервере (запуск с --server-mode).'
  if (process.platform !== 'win32') return 'Только в Windows.'
  if (!process.env.PORTABLE_EXECUTABLE_FILE) return 'Только для portable-exe (Raid OS Server.exe).'
  return ''
}

function theUpdater() {
  updater ??= new ServerSelfUpdater({
    root: join(stateDir(), 'staging'),
    current: async () => ref(await runningBuild()),
    source,
    settings: () => {
      const settings = selfUpdateSettings()
      return { enabled: settings.enabled && !unsupported(), window: settings.window }
    },
    skipped: () => meta().skipped,
    install: installRelease,
    // One journal line per new error, not one every 15 minutes.
    onStatus: (status) => {
      if (status.phase === 'error' && status.error && status.error !== lastJournaled) hooks.journal('warn', `Автообновление: ${status.error}`)
      if (status.phase !== 'checking') lastJournaled = status.phase === 'error' ? status.error : undefined
      if (status.phase === 'ready' && status.waitingForInstall && status.latest) notifyReady(status.latest)
    },
  })
  return updater
}

export async function selfUpdateStatus(): Promise<SelfUpdateView> {
  const pending = readJson<PendingRestart>(pendingFile())
  const result = pending ? readJson<HelperResult>(resultFile()) : null
  const saved = meta()
  return {
    ...selfUpdateSettings(),
    unsupported: unsupported(),
    current: ref(await runningBuild()),
    previous: saved.previous ? { version: saved.previous.version, build: saved.previous.build, commit: saved.previous.commit, savedAt: saved.previous.savedAt } : null,
    updater: theUpdater().snapshot(),
    ready: theUpdater().readyBuild(),
    restart: pending ? { kind: pending.kind, from: pending.from, to: pending.to, startedAt: pending.startedAt, deadlineAt: pending.deadlineAt, phase: result?.phase ?? 'restarting' } : null,
    history: history(),
    skipped: saved.skipped,
    ...(nextCheckAt ? { nextCheckAt: new Date(nextCheckAt).toISOString() } : {}),
  }
}

/** Manual mode: a verified build is waiting. Journal + Windows notification once per build (remembered across restarts). */
function notifyReady(build: BuildRef) {
  const saved = meta()
  if (saved.readyNotified === build.build) return
  void writeJson(metaFile(), { ...saved, readyNotified: build.build }).catch(() => {})
  const text = `Сборка ${build.version} (${build.build}): ${READY_FOR_INSTALL_TEXT.toLowerCase()}. Установите кнопкой «Установить сейчас»: приложение на ноутбуке → «Автообновление сервера» или сайт → Админ-панель → «Обновление».`
  hooks.journal('info', `Автообновление: ${text}`)
  hooks.notify('Raid OS: новая версия сервера готова', text)
}

/** «Проверить сейчас» (owner panel or the website): starts a check and answers after a few seconds with the status. */
export async function checkSelfUpdateNow() {
  if (unsupported()) throw new Error(`Автообновление недоступно: ${unsupported()}`)
  if (!selfUpdateSettings().enabled) throw new Error('Автообновление сервера выключено (приложение на ноутбуке → «Автообновление сервера»).')
  if (swapping || readJson<PendingRestart>(pendingFile())) throw new Error('Сейчас идёт перезапуск после обновления или отката')
  const running = theUpdater().check()
  await Promise.race([running, new Promise((resolve) => setTimeout(resolve, 5000))])
  return selfUpdateStatus()
}

/**
 * «Установить сейчас» (owner panel or the website, `{ confirm: true }`): installs the downloaded and verified build in
 * any install mode. Answers once the install has started (the server then restarts) or with its error.
 */
export async function installSelfUpdateNow(payload?: unknown) {
  if (!payload || typeof payload !== 'object' || (payload as { confirm?: unknown }).confirm !== true) throw new Error('Подтвердите установку')
  if (unsupported()) throw new Error(`Автообновление недоступно: ${unsupported()}`)
  if (!selfUpdateSettings().enabled) throw new Error('Автообновление сервера выключено (приложение на ноутбуке → «Автообновление сервера»).')
  if (swapping || readJson<PendingRestart>(pendingFile())) throw new Error('Сейчас уже идёт обновление или откат')
  const instance = theUpdater()
  if (!instance.readyBuild()) throw new Error('Нет скачанной и проверенной версии: нажмите «Проверить сейчас» и дождитесь «Скачано и проверено, ждёт установки»')
  hooks.journal('info', 'Автообновление: владелец нажал «Установить сейчас».')
  const running = instance.installNow()
  const outcome = await Promise.race([running, new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))])
  if (outcome === 'error') throw new Error(instance.snapshot().error || 'Установка не удалась')
  return selfUpdateStatus()
}

// --- install ---------------------------------------------------------------------------------------------------------

/** Copies `from` to `to` through a temporary file and checks the copy against `expected` (size and SHA-256). */
async function copyVerified(from: string, to: string, expected?: { size: number; sha256: string }) {
  const partial = `${to}.partial`
  await rm(partial, { force: true })
  await copyFile(from, partial)
  const digest = await fileDigest(partial)
  if (expected && (digest.size !== expected.size || digest.sha256 !== expected.sha256)) {
    await rm(partial, { force: true })
    throw new Error(`Копия ${basename(to)} не совпадает с проверенным файлом`)
  }
  await rename(partial, to)
  return digest
}

async function requestBackup() {
  try {
    await fetch(`http://127.0.0.1:${LOCAL_PORTS.api}/health/backup`, { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'before-restart' }) })
  } catch { /* the update goes on; the daily backups still exist */ }
}

const exePaths = () => {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE!
  const previousDir = join(dirname(exe), 'previous')
  return { exe, next: `${exe}.update`, previousDir, previousExe: join(previousDir, basename(exe)), previousClient: join(previousDir, 'client'), clientDir: clientPublishDir() }
}

async function copyFolderFiles(from: string, to: string) {
  await mkdir(to, { recursive: true })
  for (const name of await readdir(from).catch(() => [] as string[])) {
    if (/\.exe$/i.test(name) || name === 'version.json') await copyFile(join(from, name), join(to, name))
  }
}

async function clearPublished(dir: string) {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (/\.exe$/i.test(name) || name === 'version.json') await rm(join(dir, name), { force: true })
  }
}

/** Saves the running exe as `previous` (with its hash, so a later rollback can check it). */
async function savePrevious(current: BuildRef, withClient: boolean) {
  const { exe, previousDir, previousExe } = exePaths()
  await mkdir(previousDir, { recursive: true })
  const digest = await copyVerified(exe, previousExe)
  const saved = meta()
  await writeJson(metaFile(), { ...saved, previous: { ...current, size: digest.size, sha256: digest.sha256, savedAt: new Date().toISOString(), client: withClient } })
}

/** Called by ServerSelfUpdater with a release it has just verified from scratch (signature, parts, exes). */
async function installRelease(release: StagedRelease) {
  const why = unsupported()
  if (why) throw new Error(why)
  if (swapping) throw new Error('Обновление уже устанавливается')
  const current = ref(await runningBuild())
  const target = { version: release.manifest.version, build: release.manifest.build, commit: release.manifest.commit }
  if (target.build <= current.build) throw new Error('Сборка не новее установленной: откат версии автоматически не выполняется')
  swapping = true
  const { exe, next, previousClient, clientDir } = exePaths()
  const withClient = Boolean(release.clientExe && release.versionJson && clientDir)
  let clientChanged = false
  try {
    hooks.journal('info', `Автообновление: устанавливаю ${target.version} (сборка ${target.build}), сейчас ${current.version} (${current.build}).`)
    await requestBackup()
    // 1. The players' version: the current one goes to previous\client, the new one is published (as Server-Laptop-Setup.cmd does).
    if (withClient) {
      await rm(previousClient, { recursive: true, force: true })
      await copyFolderFiles(clientDir, previousClient)
      await mkdir(clientDir, { recursive: true })
      const name = `Raid OS ${release.versionJson!.version.replace(/[^0-9A-Za-z._-]/g, '')}.exe`
      const staged = join(clientDir, `${name}.new`)
      await copyVerified(release.clientExe!, staged, { size: release.manifest.client!.size, sha256: release.manifest.client!.sha256 })
      clientChanged = true
      await clearPublished(clientDir)
      await rename(staged, join(clientDir, name))
      await writeFile(join(clientDir, 'version.json'), `${JSON.stringify(release.versionJson)}\n`)
    }
    // 2. The running exe becomes `previous`; 3. the verified new exe waits next to it.
    await savePrevious(current, withClient)
    await copyVerified(release.ownerExe, next, { size: release.manifest.owner.size, sha256: release.manifest.owner.sha256 })
    await handOver({ kind: 'update', from: current, to: target, exe, next, withClient })
  } catch (error) {
    swapping = false
    // Nothing was swapped: the players get back the version that was published before.
    if (clientChanged) await clearPublished(clientDir).then(() => copyFolderFiles(previousClient, clientDir)).catch(() => {})
    await rm(next, { force: true }).catch(() => {})
    hooks.journal('error', `Автообновление: установка не удалась — ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}

const stamp = (date = new Date()) => {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/** A line from the app itself in update-helper.log (so the log also shows what happened before the helper ran). */
async function appendHelperLog(text: string) {
  await mkdir(stateDir(), { recursive: true }).catch(() => {})
  await appendFile(helperLogFile(), `${stamp()} [app] ${text}\r\n`).catch(() => {})
}

/** The log of the previous restart is kept as *.prev.log; update-helper.log holds this restart only. */
async function rotateHelperLog() {
  for (const file of [helperLogFile(), helperLogFile().replace(/\.log$/, '.transcript.log')]) {
    if (existsSync(file)) await rename(file, file.replace(/\.log$/, '.prev.log')).catch(() => {})
  }
}

/** The sanitized tail of update-helper.log (last 64 KB read). */
async function readHelperLogTail() {
  try {
    const handle = await open(helperLogFile(), 'r')
    try {
      const { size } = await handle.stat()
      const length = Math.min(size, 64 * 1024)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, size - length)
      return sanitize(helperLogTail(buffer.toString('utf8')), 6000)
    } finally { await handle.close() }
  } catch { return '' }
}

/**
 * Is the helper of restart `id` still working? It wrote helper.pid with this id, that process exists and it wrote to
 * update-helper.log within HELPER_SILENT_MS. Otherwise it never started, was killed, or exited without a result.
 */
function helperAlive(id: string) {
  const info = readJson<{ id?: unknown; pid?: unknown }>(helperPidFile())
  if (!info || String(info.id) !== id || typeof info.pid !== 'number' || !Number.isSafeInteger(info.pid) || info.pid <= 0) return false
  try { process.kill(info.pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EPERM') return false }
  try { return Date.now() - statSync(helperLogFile()).mtimeMs <= HELPER_SILENT_MS } catch { return false }
}

/** Waits until the helper of restart `id` has written helper.pid (it really runs) or the launcher failed. */
async function waitForHelper(id: string, launchError: () => string) {
  const until = Date.now() + HELPER_START_TIMEOUT_MS
  while (Date.now() < until) {
    const info = readJson<{ id?: unknown }>(helperPidFile())
    if (info && String(info.id) === id) return true
    if (launchError()) return false
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

/** Environment variables the helper's PowerShell gets (the list the first, working version used, plus a few basics). */
const HELPER_ENV_KEYS = ['SystemRoot', 'windir', 'SystemDrive', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME', 'USERDOMAIN',
  'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'ComSpec', 'PSModulePath', 'ProgramFiles', 'ProgramData', 'ProgramFiles(x86)',
  'CommonProgramFiles', 'ALLUSERSPROFILE', 'PUBLIC', 'COMPUTERNAME', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS']

function fullEnvironment() {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (typeof value === 'string' && !/^(ELECTRON_|NODE_OPTIONS$)/i.test(key)) env[key] = value
  return env
}

/** One argument for a verbatim Windows command line. */
const quoteArg = (value: string) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value)

const elapsed = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)} s`

/** Starts PowerShell with a one-line command and says how it ended: the first thing to read when the helper is silent. */
async function probe(powershell: string, env: Record<string, string>) {
  const since = Date.now()
  return await new Promise<string>((resolve) => {
    let done = false
    const finish = (text: string) => { if (!done) { done = true; clearTimeout(timer); resolve(text) } }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', 'exit 7'], { detached: true, windowsHide: true, stdio: 'ignore', env })
    } catch (error) {
      resolve(`PowerShell could not be started: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      finish(`PowerShell (pid ${child.pid ?? '?'}) did not finish «exit 7» within ${PROBE_TIMEOUT_MS / 1000} s — it hangs at start; stopped it`)
    }, PROBE_TIMEOUT_MS)
    child.on('error', (error) => finish(`PowerShell failed to start: ${error.message}`))
    child.on('exit', (code, signal) => finish(code === 7 ? `PowerShell works (exit 7 after ${elapsed(since)})` : `PowerShell ended with code ${code ?? signal} after ${elapsed(since)} (expected 7)`))
  })
}

/** Starts one attempt and waits for helper.pid; says how the process ended if the helper never reported. */
async function launchAndWait(attempt: { name: string; file: string; args: string[]; env: Record<string, string>; verbatim?: boolean }, id: string): Promise<{ started: boolean; detail: string }> {
  const since = Date.now()
  let ended = ''
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(attempt.file, attempt.args, { detached: true, windowsHide: true, stdio: 'ignore', env: attempt.env, windowsVerbatimArguments: attempt.verbatim === true })
  } catch (error) {
    return { started: false, detail: `could not start: ${error instanceof Error ? error.message : String(error)}` }
  }
  child.on('error', (error) => { ended ||= `failed to start: ${error.message}` })
  child.on('exit', (code, signal) => { ended ||= `process ended with code ${code ?? signal} after ${elapsed(since)}` })
  child.unref()
  await appendHelperLog(`attempt "${attempt.name}": spawned${child.pid ? ` pid ${child.pid}` : ' (no pid)'}`)
  // «cmd /c start» ends at once by design: only the helper's own helper.pid counts there.
  const fatal = () => (attempt.name === 'cmd-start' ? '' : ended.startsWith('failed') || /code [^0]/.test(ended) ? ended : '')
  if (await waitForHelper(id, fatal)) return { started: true, detail: '' }
  if (!ended) {
    try { child.kill() } catch { /* already gone */ }
    return { started: false, detail: `no helper.pid within ${HELPER_START_TIMEOUT_MS / 1000} s; the process was still running (stopped it)` }
  }
  return { started: false, detail: `no helper.pid; ${ended}` }
}

/**
 * Writes the pending state, starts the helper (through a launcher, so it is not in this app's process tree), waits
 * until it really runs and quits; the helper swaps, restarts and checks health. If the helper does not start, the
 * restart is cancelled (state.json removed, so a late helper does nothing), recorded and reported, and this copy keeps
 * running; the caller undoes its preparations.
 */
async function handOver(plan: { kind: 'update' | 'rollback'; from: BuildRef; to: BuildRef; exe: string; next: string; withClient: boolean }) {
  const { previousExe, previousClient, clientDir } = exePaths()
  const now = Date.now()
  for (const file of [resultFile(), confirmFile(), helperPidFile(), appPidFile()]) await rm(file, { force: true })
  await rotateHelperLog()
  const pending: PendingRestart = { id: `${now}`, kind: plan.kind, from: plan.from, to: plan.to, startedAt: new Date(now).toISOString(), deadlineAt: new Date(now + HEALTH_RULES.deadlineMs + 60_000).toISOString(), helper: 2 }
  await writeJson(pendingFile(), pending)
  await writeFile(helperFile(), `\uFEFF${helperScript()}`, 'utf8')
  // The same short environment the first, working version gave PowerShell, plus the paths the helper needs.
  const env: Record<string, string> = {}
  for (const key of HELPER_ENV_KEYS) if (process.env[key]) env[key] = process.env[key]!
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  Object.assign(env, helperEnvironment({
    id: pending.id, exe: plan.exe, next: plan.next, previous: previousExe, clientDir: plan.withClient ? clientDir : '', clientPrevious: plan.withClient ? previousClient : '',
    resultFile: resultFile(), confirmFile: confirmFile(), pendingFile: pendingFile(), logFile: helperLogFile(), helperPidFile: helperPidFile(), appPidFile: appPidFile(),
    appExe: process.execPath, pid: process.pid, expectedBuild: plan.to.build, args: process.argv,
  }), { RAIDOS_POWERSHELL: powershell, RAIDOS_HELPER: helperFile() })
  await appendHelperLog(`${plan.kind} ${plan.from.version} (${plan.from.build}) -> ${plan.to.version} (${plan.to.build}), restart ${pending.id}: starting the helper; app pid ${process.pid} (${process.execPath}), wrapper ${plan.exe}; PowerShell ${existsSync(powershell) ? 'found' : 'NOT FOUND'} at ${powershell}`)
  // Does PowerShell start and finish at all from this app? (On one laptop it started, printed nothing and never ran
  // a line of the helper.) The answer goes into the log either way; the attempts follow regardless.
  await appendHelperLog(`probe: ${await probe(powershell, env)}`)
  const helperArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', helperFile()]
  const comspec = process.env.ComSpec || join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
  // 1: the helper directly, exactly as the first working version; 2: through the launcher (its own process tree);
  // 3: through cmd «start», the way Explorer starts programs, with the app's whole environment.
  const attempts: Array<{ name: string; file: string; args: string[]; env: Record<string, string>; verbatim?: boolean }> = [
    { name: 'direct', file: powershell, args: helperArgs, env },
    { name: 'launcher', file: powershell, args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedCommand(launcherScript())], env },
    { name: 'cmd-start', file: comspec, args: ['/d', '/c', 'start', '""', '/min', quoteArg(powershell), ...helperArgs.map(quoteArg)], env: { ...fullEnvironment(), ...env }, verbatim: true },
  ]
  let started = false
  let lastError = ''
  for (const attempt of attempts) {
    const outcome = await launchAndWait(attempt, pending.id)
    if (outcome.started) { started = true; await appendHelperLog(`attempt "${attempt.name}": the helper runs`); break }
    lastError = outcome.detail
    await appendHelperLog(`attempt "${attempt.name}" failed: ${outcome.detail}`)
  }
  if (!started) {
    await rm(pendingFile(), { force: true })
    await appendHelperLog(`the helper did not start: restart cancelled, this copy keeps running`)
    await record(pending, { phase: 'failed', reason: 'helper-not-started', at: new Date().toISOString() }, plan.from)
    throw new Error(HEALTH_REASON_TEXT['helper-not-started'] + (lastError ? ` (${lastError})` : ''))
  }
  await appendHelperLog('the helper runs; quitting')
  hooks.journal('info', `${plan.kind === 'update' ? 'Автообновление' : 'Откат'}: перезапуск на ${plan.to.version} (${plan.to.build}); проверка здоровья до 2 минут, при сбое — возврат на ${plan.from.version}. Журнал помощника: self-update\\update-helper.log.`)
  // Answer the website / panel first, then quit (the window closes normally: the API and the database close cleanly).
  setTimeout(() => app.quit(), 1500)
}

/** Exchanges the published players' version and previous\client (symmetric: a second call undoes the first). */
async function exchangeClient() {
  const { previousClient, clientDir } = exePaths()
  const swap = `${previousClient}-swap`
  await rm(swap, { recursive: true, force: true })
  await copyFolderFiles(clientDir, swap)
  await clearPublished(clientDir)
  await copyFolderFiles(previousClient, clientDir)
  await rm(previousClient, { recursive: true, force: true })
  await rename(swap, previousClient)
}

/** «Откатить на предыдущую»: the saved previous exe (hash checked) goes back in, through the same helper and health check. */
export async function rollbackToPrevious(payload?: unknown) {
  if (!payload || typeof payload !== 'object' || (payload as { confirm?: unknown }).confirm !== true) throw new Error('Подтвердите откат')
  const why = unsupported()
  if (why) throw new Error(why)
  if (swapping || readJson<PendingRestart>(pendingFile())) throw new Error('Сейчас уже идёт обновление или откат')
  const saved = meta()
  const previous = saved.previous
  const { exe, next, previousExe, previousClient, clientDir } = exePaths()
  if (!previous || !existsSync(previousExe)) throw new Error('Нет сохранённой предыдущей версии: она появляется после первого автообновления')
  const current = ref(await runningBuild())
  if (previous.build === current.build) throw new Error('Предыдущая версия совпадает с текущей')
  swapping = true
  let clientExchanged = false
  let previousReplaced = false
  try {
    // The saved copy must be exactly the exe that ran before (nothing changed it on disk since).
    await copyVerified(previousExe, next, { size: previous.size, sha256: previous.sha256 })
    const withClient = previous.client && existsSync(previousClient) && Boolean(clientDir)
    if (withClient) { await exchangeClient(); clientExchanged = true }
    previousReplaced = true
    await savePrevious(current, withClient)
    // The build we leave is not installed automatically again (a newer one is).
    await writeJson(metaFile(), { ...meta(), skipped: [...new Set([...meta().skipped, current.build])].slice(-20) })
    await handOver({ kind: 'rollback', from: current, to: ref(previous), exe, next, withClient })
  } catch (error) {
    swapping = false
    // Nothing was swapped: put back the saved previous exe, its record and the players' version.
    if (previousReplaced) await copyVerified(next, previousExe, { size: previous.size, sha256: previous.sha256 }).catch(() => {})
    await writeJson(metaFile(), saved).catch(() => {})
    if (clientExchanged) await exchangeClient().catch(() => {})
    await rm(next, { force: true }).catch(() => {})
    throw error
  }
  return selfUpdateStatus()
}

// --- after the restart ------------------------------------------------------------------------------------------------

async function siteOk() {
  try {
    const response = await fetch(`http://127.0.0.1:${LOCAL_PORTS.site}/`, { signal: AbortSignal.timeout(4000) })
    await response.arrayBuffer().catch(() => null)
    return response.status === 200
  } catch { return false }
}

const RESULT_TEXT = (result: HelperResult) => {
  const reason = result.reason as HealthReason | HelperFailure | 'restore-failed' | undefined
  if (reason === 'restore-failed') return 'не удалось вернуть предыдущую версию — запустите Server-Laptop-Setup.cmd'
  return reason && reason in HEALTH_REASON_TEXT ? HEALTH_REASON_TEXT[reason as keyof typeof HEALTH_REASON_TEXT] : reason || ''
}

/** Failures that say nothing about the new build itself: it is not marked «не ставить» and can be installed again. */
const NOT_THE_BUILDS_FAULT = new Set(['helper-lost', 'helper-not-started', 'swap-failed'])

/** Records the outcome of a restart: history (with the helper log tail for a failure), journal, notification, report. */
async function record(pending: PendingRestart, result: HelperResult, running: BuildRef) {
  const outcome: HistoryEntry['result'] = result.phase === 'ok' ? 'ok' : result.phase === 'rolled-back' ? 'rolled-back' : 'failed'
  const code = outcome === 'ok' ? undefined : result.reason || undefined
  const reason = outcome === 'ok' ? undefined : RESULT_TEXT(result) || 'неизвестная причина'
  const log = outcome === 'ok' ? '' : await readHelperLogTail()
  const entry: HistoryEntry = { at: result.at ?? new Date().toISOString(), kind: pending.kind, from: pending.from, to: pending.to, result: outcome, ...(reason ? { reason } : {}), ...(code ? { code } : {}), ...(log ? { log } : {}) }
  await writeJson(historyFile(), [entry, ...history()].slice(0, 30))
  const skip = outcome !== 'ok' && pending.kind === 'update' && !NOT_THE_BUILDS_FAULT.has(code ?? '') && running.build !== pending.to.build
  if (skip) await writeJson(metaFile(), { ...meta(), skipped: [...new Set([...meta().skipped, pending.to.build])].slice(-20) })
  const what = pending.kind === 'update' ? 'Обновление' : 'Откат'
  if (outcome === 'ok') {
    hooks.journal('info', `${what}: работает ${pending.to.version} (сборка ${pending.to.build}), проверка здоровья пройдена.`)
    hooks.notify(pending.kind === 'update' ? 'Сервер обновлён' : 'Сервер откачен', `Работает версия ${pending.to.version} (сборка ${pending.to.build}).`, true)
    return outcome
  }
  const text = outcome === 'rolled-back'
    ? `${what} до ${pending.to.version} (${pending.to.build}) не прошёл проверку: ${reason}. Возвращена ${pending.from.version} (${pending.from.build}); эта сборка больше не ставится автоматически.`
    : `${what} до ${pending.to.version} (${pending.to.build}) не выполнен: ${reason}. Сейчас работает ${running.version} (${running.build}).`
  hooks.journal('error', text)
  hooks.notify(outcome === 'rolled-back' ? 'Обновление сервера откачено' : 'Обновление сервера не удалось', text)
  hooks.report({
    source: 'update', kind: outcome === 'rolled-back' ? 'rollback' : code === 'helper-lost' || code === 'helper-not-started' ? code : 'failed',
    name: `SelfUpdate:${code ?? outcome}`, message: text, context: `${pending.from.build} → ${pending.to.build}`,
    ...(log ? { stack: `update-helper.log (tail):\n${log}` } : {}),
  })
  return outcome
}

async function finalize(pending: PendingRestart, result: HelperResult, running: BuildRef) {
  const outcome = await record(pending, result, running)
  for (const file of [pendingFile(), resultFile(), confirmFile(), helperPidFile(), appPidFile()]) await rm(file, { force: true })
  // A verified exe that was never moved into place is not needed.
  if (outcome !== 'ok' && process.env.PORTABLE_EXECUTABLE_FILE) await rm(exePaths().next, { force: true }).catch(() => {})
  // The downloaded parts and exes are not needed any more (a rolled-back build is skipped from now on); after a failure
  // that was not the build's fault they stay, so «Установить сейчас» does not download them again.
  if (outcome === 'ok' || !NOT_THE_BUILDS_FAULT.has(result.reason ?? '')) await rm(join(stateDir(), 'staging'), { recursive: true, force: true }).catch(() => {})
}

const FINAL_PHASES = ['ok', 'rolled-back', 'failed']

/**
 * On start (server laptop): finish a pending update or rollback. The new build checks its own health (healthVerdict)
 * and confirms through confirm.json; the helper writes the final result; this records it. A helper that is gone without
 * a final result (never ran, killed, blocked, laptop restarted) is recorded as 'helper-lost' with its log.
 */
async function finishPending() {
  const pending = readJson<PendingRestart>(pendingFile())
  if (!pending) return
  const running = ref(await runningBuild())
  // The helper stops exactly this process (and its wrapper) if it has to roll back.
  await writeJson(appPidFile(), { pid: process.pid, exe: process.execPath, build: running.build }).catch(() => {})
  let state: HealthState = { startedAt: Date.now(), okStreak: 0 }
  let confirmed = false
  const finalResult = () => {
    const result = readJson<HelperResult>(resultFile())
    return result && FINAL_PHASES.includes(result.phase) ? result : null
  }
  const hardStop = Math.max(Date.parse(pending.deadlineAt), Date.now() + HEALTH_RULES.deadlineMs) + 90_000
  while (Date.now() < hardStop) {
    const result = finalResult()
    if (result) { await finalize(pending, result, running); return }
    if (pending.helper && !helperAlive(pending.id)) {
      // It may have written its result right before exiting.
      const late = finalResult()
      await finalize(pending, late ?? { phase: 'failed', reason: 'helper-lost', at: new Date().toISOString() }, running)
      return
    }
    if (running.build === pending.to.build && !confirmed) {
      const health = await apiHealth()
      const body = health?.body as { ok?: unknown; build?: { build?: unknown } } | null | undefined
      const verdict = healthVerdict(state, { api: body ? { ok: body.ok === true, build: Number(body.build?.build) || undefined } : null, siteOk: await siteOk() }, pending.to.build, Date.now())
      state = verdict.state
      if (verdict.verdict === 'healthy') {
        confirmed = true
        await writeJson(confirmFile(), { build: running.build, at: new Date().toISOString() })
      }
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_RULES.intervalMs))
  }
  // The helper never reported a final result: judge by what runs now.
  const last = readJson<HelperResult>(resultFile())
  const fallback: HelperResult = confirmed && running.build === pending.to.build ? { phase: 'ok' }
    : !last ? { phase: 'failed', reason: 'helper-lost' }
      : running.build === pending.to.build ? { phase: 'failed', reason: 'api-not-responding' } : { phase: 'failed', reason: 'start-failed' }
  await finalize(pending, { ...fallback, at: new Date().toISOString() }, running)
}

/** Server laptop (owner build, --server-mode): finish what a restart left, then check every 15 minutes. */
export function startServerSelfUpdate(next: SelfUpdateHooks) {
  hooks = next
  if (!isOwnerBuild() || !isServerMode() || timer) return
  void finishPending().catch((error: unknown) => hooks.journal('error', `Автообновление: ${error instanceof Error ? error.message : String(error)}`))
  const run = () => {
    nextCheckAt = Date.now() + CHECK_EVERY_MS
    if (readJson<PendingRestart>(pendingFile()) || swapping) return
    void theUpdater().check()
  }
  nextCheckAt = Date.now() + FIRST_CHECK_MS
  const first = setTimeout(() => { run(); timer = setInterval(run, CHECK_EVERY_MS) }, FIRST_CHECK_MS)
  first.unref?.()
  timer = first
}

export function stopServerSelfUpdate() {
  if (timer) { clearTimeout(timer); clearInterval(timer) }
  timer = null
}
