import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Notification, type BrowserWindow } from 'electron'
import { apiHealth, isServerMode, LOCAL_PORTS, localServerEnabled, localServerProcesses, portTaken, repairApi, repairSite, runningBuild, serverLogsDir } from './localServer.js'
import { describeBuild, isStaleOwnServer, OUR_SERVICE } from './staleServer.js'
import { restartTunnel, tunnelProcess, tunnelStatus } from './publicTunnel.js'
import { ServerWatchdog, type ProbeResult, type ServiceId, type WatchdogAlert } from './serverWatchdog.js'
import { ServerGuardian, type GuardDetail } from './serverGuardian.js'

/**
 * Real probes, repairs and notifications for the watchdog (electron/serverWatchdog.ts) on the owner's PC:
 * - «Сервер (API)»: GET http://127.0.0.1:8787/health; repair = restart the API utility process;
 * - «Сайт»: GET http://127.0.0.1:5202/; repair = listen again;
 * - «Публичный адрес»: the cloudflared state, and for the permanent address a GET https://<host>/health through the
 *   internet once a minute; repair = restart cloudflared;
 * - «База данных»: the `database` flag of the API's /health (repaired by the API restart) and the hourly quick_check;
 * - «Безопасность»: «Страж сервера» (electron/serverGuardian.ts over the API's /health/detail): bans, error rate,
 *   restarts-for-error with a backup first, daily backups (docs/server-guard.md).
 * Alerts: a Windows notification, an in-app toast (IPC 'server-watchdog:alert') and `emailHook` (not wired yet).
 */

let watchdog: ServerWatchdog | null = null
let guardian: ServerGuardian | null = null
let publicCache: { at: number; result: ProbeResult; key: string } | null = null

/** Later: an e-mail to the owner with the same alert (no mail service yet). */
export let emailHook: ((alert: WatchdogAlert) => void) | null = null
export function setEmailHook(hook: ((alert: WatchdogAlert) => void) | null) { emailHook = hook }

async function getJson(url: string, timeoutMs: number) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'cache-control': 'no-cache' } })
  const body = await response.json().catch(() => null) as { ok?: unknown; database?: unknown } | null
  return { status: response.status, body }
}

/** GET /health/detail: this PC only (server/src/routes/serverGuard.ts); null for an older server or no answer. */
async function healthDetail(): Promise<GuardDetail | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${LOCAL_PORTS.api}/health/detail`, { signal: AbortSignal.timeout(4000), headers: { 'cache-control': 'no-cache' } })
    return response.status === 200 ? await response.json() as GuardDetail : null
  } catch {
    return null
  }
}

/** POST /health/backup: the API writes the copy itself (VACUUM INTO on its own connection). */
async function requestBackup(kind: 'daily' | 'before-restart'): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  try {
    const response = await fetch(`http://127.0.0.1:${LOCAL_PORTS.api}/health/backup`, { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) })
    const body = await response.json().catch(() => null) as { backup?: { name?: string }; error?: string } | null
    if (response.ok && body?.backup?.name) return { ok: true, name: body.backup.name }
    return { ok: false, error: body?.error ?? `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const reason = (error: unknown) => (error instanceof Error ? (error.name === 'TimeoutError' ? 'нет ответа (тайм-аут)' : error.message) : String(error))

async function probeApi(): Promise<ProbeResult> {
  const processes = localServerProcesses()
  const answer = await apiHealth()
  const health = answer?.body ?? null
  const ours = processes.apiAlive
  if (answer && !ours) {
    // Not the process this app started: our own API from another build (e.g. a leftover older server), or a stranger.
    if (health?.service !== OUR_SERVICE) return { kind: 'blocked', error: `Порт ${LOCAL_PORTS.api} занят другой программой (HTTP ${answer.status}).` }
    if (isStaleOwnServer(health, await runningBuild())) {
      const error = `Порт ${LOCAL_PORTS.api} занят старым сервером (сборка ${describeBuild(health)}).`
      // The server laptop repairs it itself; elsewhere the owner presses «Перезапустить сейчас».
      return isServerMode() ? { kind: 'down', error, dead: true } : { kind: 'blocked', error: `${error} Нажмите «Перезапустить сейчас».` }
    }
  }
  if (health?.ok === true) {
    // «Страж сервера»: our own process with a high error rate, repeated exceptions, a stall or memory growth is
    // restarted like a dead one (backup first, rate-limited in serverGuardian.ts).
    const verdict = ours && guardian ? await guardian.inspect() : null
    if (verdict?.restart) return { kind: 'down', error: verdict.restart, dead: true }
    return { kind: 'ok', text: ours ? 'работает' : 'работает (запущен отдельно)' }
  }
  if (answer) return { kind: 'down', error: health?.database === false ? 'База данных не отвечает.' : `Сервер ответил с ошибкой (HTTP ${answer.status}).` }
  if (processes.api === 'error' && /не входит в эту сборку/.test(processes.error)) return { kind: 'blocked', error: processes.error }
  if (!ours) {
    // Our process is gone: a foreign program on the port is reported, an empty port is repaired at once.
    if (await portTaken(LOCAL_PORTS.api)) return { kind: 'blocked', error: `Порт ${LOCAL_PORTS.api} занят другой программой, которая не отвечает как сервер.` }
    return { kind: 'down', error: processes.error || 'Процесс сервера остановился.', dead: true }
  }
  return { kind: 'down', error: 'Сервер не отвечает (тайм-аут).' }
}

async function probeSite(): Promise<ProbeResult> {
  const processes = localServerProcesses()
  try {
    const response = await fetch(`http://127.0.0.1:${LOCAL_PORTS.site}/`, { signal: AbortSignal.timeout(4000) })
    await response.arrayBuffer().catch(() => null)
    if (response.status === 200) return { kind: 'ok', text: processes.site === 'external' ? 'работает (запущен отдельно)' : 'работает' }
    return { kind: 'down', error: `Сайт ответил HTTP ${response.status}.` }
  } catch (error) {
    if (!processes.siteListening) {
      if (await portTaken(LOCAL_PORTS.site)) return { kind: 'blocked', error: `Порт ${LOCAL_PORTS.site} занят другой программой.` }
      return { kind: 'down', error: processes.error || 'Сервер сайта остановлен.', dead: true }
    }
    return { kind: 'down', error: `Сайт не отвечает: ${reason(error)}` }
  }
}

async function probePublic(): Promise<ProbeResult> {
  const tunnel = await tunnelStatus()
  const proc = tunnelProcess()
  if (tunnel.state === 'off') return { kind: 'off', text: tunnel.autoStart ? 'запускается…' : 'выключено' }
  if (tunnel.state === 'downloading') return { kind: 'starting', text: 'скачиваю cloudflared…' }
  if (tunnel.state === 'starting') return { kind: 'starting', text: 'получаю ссылку…' }
  if (tunnel.state === 'error' || !proc.running) return { kind: 'down', error: tunnel.error || 'cloudflared остановился.', dead: true }
  if (!tunnel.hostname) return { kind: 'ok', text: 'работает (временная ссылка)' }
  // cloudflared keeps running but complains a lot: Cloudflare or the site is unreachable from it.
  if (proc.recentErrors >= 5) return { kind: 'down', error: `cloudflared сообщает об ошибках: ${proc.lastErrorLine || 'нет связи с Cloudflare'}` }
  // Through the internet, once a minute (the result is reused between the 15-second checks).
  const key = tunnel.hostname
  if (publicCache && publicCache.key === key && Date.now() - publicCache.at < 55_000) return publicCache.result
  let result: ProbeResult
  try {
    const { status, body } = await getJson(`https://${tunnel.hostname}/health`, 10_000)
    result = body?.ok === true ? { kind: 'ok', text: `работает (${tunnel.hostname})` }
      // 502/530 from Cloudflare: the tunnel does not reach this PC.
      : status >= 500 ? { kind: 'down', error: `${tunnel.hostname} отвечает HTTP ${status}.` }
        : { kind: 'warn', error: `${tunnel.hostname} отвечает HTTP ${status}.` }
  } catch (error) {
    // Usually the internet on this PC, or a mistyped address (the tunnel itself routes by its token, not by this name).
    // While cloudflared reports a registered connection, restarting it would only drop the working link: warn only.
    result = { kind: 'warn', error: `${tunnel.hostname} не открывается из интернета: ${reason(error)}. Проверьте, что адрес в «Постоянный адрес» написан верно.`, advisory: tunnel.state === 'on' }
  }
  publicCache = { at: Date.now(), result, key }
  return result
}

async function probeDatabase(): Promise<ProbeResult> {
  // The API's /health runs SELECT 1 on the database (server/src/app.ts).
  const body = (await apiHealth())?.body
  if (!body) return { kind: 'unknown', text: 'нет данных (сервер не отвечает)' }
  const verdict = guardian ? await guardian.inspect() : null
  if (verdict?.database) return verdict.database
  if (typeof body.database !== 'boolean') return { kind: body.ok === true ? 'ok' : 'unknown', text: body.ok === true ? 'работает' : 'нет данных' }
  return body.database ? { kind: 'ok', text: 'работает' } : { kind: 'down', error: 'База данных не отвечает (проверка SELECT 1 не прошла).' }
}

async function probeSecurity(): Promise<ProbeResult> {
  if (!guardian) return { kind: 'unknown', text: 'нет данных' }
  return (await guardian.inspect()).security
}

/** Starts watching (owner build). `window()` gets the main window for the in-app toast and live lamps. */
export function startServerMonitor(window: () => BrowserWindow | null) {
  if (watchdog) return watchdog
  const logFile = () => join(serverLogsDir(), 'watchdog.log')
  const send = (channel: string, payload: unknown) => {
    const target = window()
    if (target && !target.isDestroyed()) target.webContents.send(channel, payload)
  }
  // Windows notification + in-app toast (rate-limited by the watchdog and the guardian) + the e-mail hook.
  const notifyOwner = (alert: WatchdogAlert) => {
    try {
      if (Notification.isSupported()) new Notification({ title: alert.title, body: alert.body, silent: alert.kind === 'recovered' || alert.kind === 'repaired' }).show()
    } catch { /* notifications are best effort */ }
    send('server-watchdog:alert', alert)
    try { emailHook?.(alert) } catch { /* the e-mail hook is optional */ }
  }
  guardian = new ServerGuardian({
    fetchDetail: healthDetail,
    backup: requestBackup,
    alert: (alert) => notifyOwner({ service: alert.service, kind: 'guard', title: alert.title, body: alert.body, at: alert.at }),
    note: (service, level, text) => watchdog?.note(service, level, text),
  })
  watchdog = new ServerWatchdog({
    enabled: () => localServerEnabled(),
    services: {
      api: { label: 'Сервер (API)', probe: probeApi, restart: async () => { guardian?.noteApiRestart(); await repairApi() }, advice: `Откройте журнал ${join(serverLogsDir(), 'api.log')} или перезапустите приложение.` },
      site: { label: 'Сайт', probe: probeSite, restart: async () => { await repairSite() }, advice: 'Перезапустите приложение; если порт 5202 занят — закройте другую программу.' },
      public: { label: 'Публичный адрес', probe: probePublic, restart: async () => { publicCache = null; await restartTunnel() }, advice: 'Проверьте интернет на этом компьютере и туннель в панели Cloudflare.' },
      database: { label: 'База данных', probe: probeDatabase, notify: false },
      security: { label: 'Безопасность', probe: probeSecurity, notify: false },
    },
    alert: notifyOwner,
    changed: (snapshot) => send('server-watchdog:status', snapshot),
    log: (line) => void mkdir(serverLogsDir(), { recursive: true }).then(() => appendFile(logFile(), `${line}\n`)).catch(() => {}),
  })
  watchdog.start()
  return watchdog
}

export function stopServerMonitor() {
  watchdog?.stop()
  watchdog = null
  guardian = null
}

export function serverMonitorStatus() {
  return watchdog?.snapshot() ?? { enabled: false, services: [], events: [], worst: 'grey' as const }
}

/** «Перезапустить сейчас». */
export async function restartServiceNow(raw: unknown) {
  const id = (['api', 'site', 'public'] as ServiceId[]).find((service) => service === raw)
  if (!watchdog || !id) return serverMonitorStatus()
  if (id === 'public') publicCache = null
  await watchdog.restartNow(id)
  await watchdog.check()
  return watchdog.snapshot()
}

/** «Проверить сейчас». */
export async function checkServicesNow() {
  if (!watchdog) return serverMonitorStatus()
  publicCache = null
  await watchdog.check()
  return watchdog.snapshot()
}
