import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { app } from 'electron'
import { runningBuild } from './localServer.js'
import { apiBaseUrl, loadServerUrl } from './serviceGateway.js'

/**
 * Auto-update from the owner's server: the server laptop's site hands out the exe it runs
 * (/download/windows) and says which build that is (/download/version.json, electron/localServer.ts).
 * A newer build is offered in the top bar; «Обновить» downloads it next to this exe, checks size and SHA-256,
 * then a small helper replaces the exe once this copy has quit and starts the new one. Only for the portable exe
 * pointed at another computer's server (Profile → «Адрес сервера»); the server laptop itself is updated by
 * Server-Laptop-Setup.cmd.
 */
export type UpdateState = 'idle' | 'available' | 'downloading' | 'installing' | 'error'
export interface UpdateStatus { state: UpdateState; version?: string; commit?: string; progress?: number; error?: string }

interface Remote { version: string; build: number; commit: string; size: number; sha256: string }

const CHECK_DELAY_MS = 20_000
const CHECK_EVERY_MS = 6 * 60 * 60_000

let status: UpdateStatus = { state: 'idle' }
let remote: Remote | null = null
let source = ''
let notify: (status: UpdateStatus) => void = () => {}
let timer: NodeJS.Timeout | null = null

function set(next: UpdateStatus) {
  status = next
  notify(status)
}

export function updateStatus() {
  return status
}

/** The other computer's site (the public server address), or '' when there is nothing to update from. */
async function updateSource() {
  await loadServerUrl()
  let base: URL
  try { base = new URL(apiBaseUrl()) } catch { return '' }
  if (['127.0.0.1', 'localhost'].includes(base.hostname)) return '' // this PC's own server runs this very exe
  return base.origin
}

export async function checkForUpdate() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!exe || status.state === 'downloading' || status.state === 'installing') return status
  const local = await runningBuild()
  const base = await updateSource()
  if (!base || !local.build) return status
  try {
    const response = await fetch(`${base}/download/version.json`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } })
    if (!response.ok) return status
    const data = await response.json() as Partial<Remote>
    if (typeof data.build !== 'number' || typeof data.size !== 'number' || typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)) return status
    if (data.build <= local.build) { remote = null; if (status.state === 'available') set({ state: 'idle' }); return status }
    remote = { version: String(data.version ?? ''), build: data.build, commit: String(data.commit ?? ''), size: data.size, sha256: data.sha256 }
    source = base
    set({ state: 'available', version: remote.version, commit: remote.commit })
  } catch { /* server offline: try again later */ }
  return status
}

export function startUpdateChecks(onStatus: (status: UpdateStatus) => void) {
  notify = onStatus
  if (timer || !app.isPackaged) return
  setTimeout(() => void checkForUpdate(), CHECK_DELAY_MS)
  timer = setInterval(() => void checkForUpdate(), CHECK_EVERY_MS)
}

/** Downloads the new exe, checks it and hands over to the helper that swaps the files; the app then quits. */
export async function installUpdate() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!exe || !remote || status.state === 'downloading' || status.state === 'installing') return status
  const target = remote
  const partial = `${exe}.update`
  const base = { version: target.version, commit: target.commit }
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
    if (received !== target.size || hash.digest('hex') !== target.sha256) throw new Error('Файл обновления повреждён, попробуйте ещё раз')
    set({ state: 'installing', ...base, progress: 100 })
    await startSwapHelper(exe, partial)
    setTimeout(() => app.quit(), 300)
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {})
    const message = error instanceof Error ? error.message : String(error)
    set({ state: 'error', ...base, error: /EPERM|EACCES/.test(message) ? 'Нет доступа к папке с приложением: переместите exe, например, на рабочий стол' : message })
  }
  return status
}

/**
 * The portable exe stays locked until this copy and its launcher have quit, so a hidden cmd waits for that, moves the
 * new file over the old one and starts it. Paths travel in environment variables: cmd reads them correctly even
 * with non-Latin folder names, which a batch file's own text would garble.
 */
async function startSwapHelper(exe: string, partial: string) {
  const script = join(tmpdir(), `tarkov-operator-update-${process.pid}.cmd`)
  await writeFile(script, [
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
    'start "" "%TO_EXE%"',
    '(goto) 2>nul & del "%~f0"',
  ].join('\r\n'), 'utf8')
  if (!existsSync(script)) throw new Error('Не удалось подготовить обновление')
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', script], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, TO_NEW: partial, TO_EXE: exe },
  })
  child.unref()
}
