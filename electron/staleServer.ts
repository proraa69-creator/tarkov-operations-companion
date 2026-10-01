import { execFile } from 'node:child_process'
import { basename } from 'node:path'

/**
 * An OLD copy of our own API server still holding 127.0.0.1:8787 (a leftover «Raid OS API» utility process of an
 * earlier app build): the site then talks to an old server (e.g. QR sign-in answers 404). The owner app may stop it,
 * but only when it is provably ours:
 *   1. /health answers `service: 'tarkov-operations-api'`;
 *   2. the process listening on the port runs our own executable (same image name as this app) — never anything else.
 * Foreign programs are never stopped; the watchdog only reports them.
 */
export const OUR_SERVICE = 'tarkov-operations-api'

export interface ApiHealth { ok?: unknown; service?: unknown; database?: unknown; build?: { version?: unknown; build?: unknown; commit?: unknown; edition?: unknown } }
export interface RunningBuild { version: string; build: number; commit: string }

/** «сборка 0.5.4 #41 (abc1234)» for the status lamp; «неизвестная (старая)» for servers older than build info. */
export function describeBuild(health: ApiHealth | null) {
  const build = health?.build
  if (!build) return 'неизвестная (старая)'
  const parts = [String(build.version ?? ''), Number(build.build) > 0 ? `#${Number(build.build)}` : '', build.commit ? `(${String(build.commit).slice(0, 7)})` : ''].filter(Boolean)
  return parts.join(' ') || 'неизвестная'
}

/**
 * Whether the server answering on the port is our own API from ANOTHER app build. Development runs (build 0, e.g.
 * scripts/start-local.ps1 with the repository) are never called stale.
 */
export function isStaleOwnServer(health: ApiHealth | null, running: RunningBuild) {
  if (!health || health.service !== OUR_SERVICE || running.build <= 0) return false
  const build = health.build
  if (!build) return true
  if (running.commit && build.commit) return String(build.commit) !== running.commit
  return Number(build.build) !== running.build
}

function run(command: string, args: string[]) {
  return new Promise<string>((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 5000 }, (error, stdout) => resolve(error ? '' : String(stdout)))
  })
}

/** PID listening on 127.0.0.1:<port> (Windows netstat; elsewhere lsof), or null. */
export async function listeningPid(port: number): Promise<number | null> {
  if (process.platform === 'win32') {
    const text = await run('netstat', ['-ano', '-p', 'TCP'])
    for (const line of text.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/)
      // Proto  Local Address  Foreign Address  State  PID
      if (columns.length >= 5 && /LISTENING/i.test(columns[3]) && new RegExp(`[:.]${port}$`).test(columns[1])) {
        const pid = Number(columns[4])
        if (pid > 0) return pid
      }
    }
    return null
  }
  const pid = Number((await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])).trim().split(/\s+/)[0])
  return pid > 0 ? pid : null
}

/** Executable image name of a process («Tarkov Operator.exe»), or '' when unknown. */
export async function processImage(pid: number): Promise<string> {
  if (process.platform === 'win32') {
    const text = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
    const match = /^"([^"]+)","(\d+)"/m.exec(text.trim())
    return match && Number(match[2]) === pid ? match[1] : ''
  }
  return basename((await run('ps', ['-p', String(pid), '-o', 'comm='])).trim())
}

/** Same executable as this app (the API utility process runs under the app's own exe). */
export function isOurImage(image: string, execPath = process.execPath) {
  const own = execPath.split(/[\\/]/).pop() ?? ''
  return Boolean(image) && image.toLowerCase() === own.toLowerCase()
}

/**
 * Stops our own old API server on `port` after both checks above. Resolves with what happened, never throws.
 * `health` is the /health answer just read from that port.
 */
export async function stopOwnServerOnPort(port: number, health: ApiHealth | null, deps = { listeningPid, processImage, kill: (pid: number) => process.kill(pid) }) {
  if (health?.service !== OUR_SERVICE) return { stopped: false, reason: `Порт ${port} занят другой программой — она не остановлена.` }
  const pid = await deps.listeningPid(port)
  if (!pid || pid === process.pid) return { stopped: false, reason: `Не удалось определить процесс на порту ${port}.` }
  const image = await deps.processImage(pid)
  if (!isOurImage(image)) return { stopped: false, reason: `Порт ${port} занят программой «${image || 'неизвестно'}» — она не остановлена.` }
  try {
    deps.kill(pid)
    return { stopped: true, reason: `Остановлен старый сервер (процесс ${pid}).` }
  } catch (error) {
    return { stopped: false, reason: `Не удалось остановить старый сервер: ${error instanceof Error ? error.message : String(error)}` }
  }
}
