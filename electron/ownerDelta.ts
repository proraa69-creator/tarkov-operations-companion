import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { deltaMismatch, fileSha256, parseDeltaInfo, stageDelta, type DeltaInfo, type DeltaSource } from './appDelta.js'
import { confirmBoot, deltaRoot, readDeltaState, writeDeltaState } from './deltaBoot.js'

/**
 * The Electron side of the owner's partial update (electron/appDelta.ts): the release's /app-delta/ files over HTTPS,
 * the running archive, staging in %APPDATA%\Raid OS Updates, switching to the staged build and restarting the portable
 * exe. electron/appUpdate.ts decides when (startup only, never in a raid), exactly as for the whole exe.
 */
const originalFs = () => createRequire(import.meta.url)('original-fs') as typeof import('node:fs')
const root = () => deltaRoot(app.getPath('appData'))

/** The archive this code runs from (the exe's app.asar or a staged one); '' in a development run. */
export function runningArchive() {
  const file = fileURLToPath(import.meta.url)
  const index = file.toLowerCase().lastIndexOf(`.asar${sep}`)
  return index < 0 ? '' : file.slice(0, index + '.asar'.length)
}

function runningBuildInfo(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'build-info.json'), 'utf8')) as Record<string, unknown> } catch { return {} }
}

let resourcesCache: Record<string, string> | null = null

/** SHA-256 of every file in resources outside the archive (OCR models, Koffi): a release may differ only inside it. */
function localResources() {
  if (resourcesCache) return resourcesCache
  const fs = originalFs()
  const out: Record<string, string> = {}
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!prefix && (entry.name === 'app.asar' || entry.name === 'app.asar.unpacked')) continue
      const path = join(dir, entry.name)
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path, name)
      else if (entry.isFile()) out[name] = fileSha256(fs, path)
    }
  }
  walk(process.resourcesPath, '')
  resourcesCache = out
  return out
}

/** The release's partial update when this copy can take it: same build, version and commit as the signed manifest. */
export async function fetchDeltaInfo(base: string, signed: { build: number; version: string; commit: string }): Promise<DeltaInfo | null> {
  if (!base.startsWith('https://') || !process.env.PORTABLE_EXECUTABLE_FILE || !runningArchive()) return null
  try {
    const response = await fetch(`${base}/app-delta/info.json?ts=${Date.now()}`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' }, cache: 'no-store' })
    if (!response.ok) return null
    const info = parseDeltaInfo(await response.json())
    if (!info || info.build !== signed.build || info.version !== signed.version || info.commit !== signed.commit) return null
    const mismatch = deltaMismatch(info, { electron: process.versions.electron, resources: localResources() })
    if (mismatch) { console.warn(`Raid OS: partial update not possible (${mismatch}), the whole exe is needed`); return null }
    return info
  } catch {
    return null // no partial update published (the site answers with its page) or offline
  }
}

function httpSource(base: string, info: DeltaInfo): DeltaSource {
  const get = async (url: string, headers: Record<string, string> = {}) => fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(10 * 60_000) })
  return {
    async range(start, end) {
      const response = await get(`${base}/app-delta/app.asar`, { Range: `bytes=${start}-${end}` })
      if (response.status !== 206) throw new Error(`Сервер не отдал часть обновления: HTTP ${response.status}`)
      // The release may have been replaced meanwhile: a different archive size stops at once.
      const total = /\/([0-9]+)$/.exec(response.headers.get('content-range') ?? '')?.[1]
      if (total && Number(total) !== info.asar.size) throw new Error('На сервере уже другой выпуск, попробуйте ещё раз')
      const data = Buffer.from(await response.arrayBuffer())
      if (data.length !== end - start + 1) throw new Error('Сервер отдал неполный кусок обновления')
      return data
    },
    async unpacked(path) {
      const response = await get(`${base}/app-delta/app.asar.unpacked/${path.split('/').map(encodeURIComponent).join('/')}`)
      if (!response.ok) throw new Error(`Сервер не отдал ${path}: HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    },
  }
}

/** Downloads the changed files and builds the new archive next to the others (not started yet). */
export async function stageOwnerDelta(base: string, info: DeltaInfo, onProgress: (done: number, total: number) => void) {
  const fs = originalFs()
  const outDir = join(root(), String(info.build))
  fs.rmSync(outDir, { recursive: true, force: true })
  try {
    return await stageDelta({ fs, info, source: httpSource(base, info), localAsar: runningArchive(), localBuildInfo: runningBuildInfo(), outDir, onProgress })
  } catch (error) {
    fs.rmSync(outDir, { recursive: true, force: true })
    throw error
  }
}

/** The next start runs the staged build; older staged builds go, except the one running now. */
export function activateOwnerDelta(info: DeltaInfo) {
  const fs = originalFs()
  const dir = root()
  const state = readDeltaState(fs, dir)
  writeDeltaState(fs, dir, { ...state, current: { build: info.build, version: info.version, commit: info.commit, dir: String(info.build) }, pending: undefined, bad: (state.bad ?? []).filter((build) => build !== info.build) })
  const running = runningArchive()
  for (const name of fs.readdirSync(dir)) {
    if (!/^[0-9]{13}$/.test(name) || name === String(info.build) || running.startsWith(join(dir, name) + sep)) continue
    try { fs.rmSync(join(dir, name), { recursive: true, force: true }) } catch { /* in use: next time */ }
  }
}

/** The window loaded its page: a staged build that got this far is good (electron/deltaBoot.ts). */
export function confirmStagedBoot() {
  if (!app.isPackaged) return
  try { confirmBoot(originalFs(), root(), process.pid) } catch { /* not a staged start */ }
}

/**
 * Starts the portable exe again once this copy and its launcher (which deletes the unpacked files on exit) are gone. A
 * hidden cmd waits for the launcher's process id; paths travel in environment variables (non-Latin folder names).
 */
export function relaunchWhenClosed(exe: string) {
  const script = join(tmpdir(), `raidos-relaunch-${process.pid}.cmd`)
  writeFileSync(script, [
    '@echo off',
    'set n=0',
    ':wait',
    'tasklist /FI "PID eq %RO_PID%" /NH 2>nul | find " %RO_PID% " >nul || goto run',
    'set /a n+=1',
    'if %n% geq 90 goto run',
    'timeout /t 1 /nobreak >nul',
    'goto wait',
    ':run',
    'timeout /t 1 /nobreak >nul',
    'start "" "%RO_EXE%"',
    '(goto) 2>nul & del "%~f0"',
  ].join('\r\n'), 'utf8')
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', script], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, RO_PID: String(process.ppid), RO_EXE: exe },
  })
  child.unref()
}
