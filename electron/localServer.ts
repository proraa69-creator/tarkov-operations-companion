import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { basename, dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { apiEnvironment } from './ownerAdmin.js'
import { buildEdition, type BuildEdition } from './buildEdition.js'
import { publicSiteUrl } from './publicTunnel.js'

/**
 * «Сервер и сайт на этом компьютере»: the owner's PC runs the account API (server/, bundled into
 * dist-electron/local-server by scripts/build-local-server.mjs) and the website (dist-electron/website)
 * from the app itself — no Node.js or repository needed. Off by default: a friend's copy of the exe stays a
 * plain standalone app. Both listen on 127.0.0.1 only, as with scripts/start-local.ps1.
 */
const API_PORT = 8787
const SITE_PORT = 5202
export const LOCAL_SITE_URL = `http://localhost:${SITE_PORT}`
const WEB_ORIGIN = ['http://localhost:5202', 'http://127.0.0.1:5202', 'http://localhost:5173', 'http://127.0.0.1:5173', 'https://localhost', 'capacitor://localhost'].join(',')

const appDir = dirname(fileURLToPath(import.meta.url))
/** Unpacked from the asar: a utility process loads its script from the real file system. */
const serverScript = () => join(appDir, '..', 'local-server', 'server.cjs').replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
const siteRoot = () => join(appDir, '..', 'website')

export type ServiceState = 'running' | 'external' | 'stopped' | 'error'
export interface LocalServerStatus { enabled: boolean; api: ServiceState; site: ServiceState; siteUrl: string; database: string; error?: string }

let apiProcess: UtilityProcess | null = null
let siteServer: Server | null = null
let apiState: ServiceState = 'stopped'
let siteState: ServiceState = 'stopped'
let lastError = ''

const dataDir = () => join(app.getPath('userData'), 'server')
const settingsFile = () => join(app.getPath('userData'), 'local-server.json')
const databasePath = () => join(dataDir(), 'companion.sqlite')

interface Saved { enabled?: boolean; /** Open the site in the browser once, when the server next starts. */ openSite?: boolean }

async function readSaved(): Promise<Saved> {
  try {
    return JSON.parse(await readFile(settingsFile(), 'utf8')) as Saved
  } catch {
    return {}
  }
}

async function save(next: Saved) {
  await writeFile(settingsFile(), JSON.stringify(next, null, 2), 'utf8').catch(() => {})
}

export async function localServerEnabled() {
  return (await readSaved()).enabled === true
}

export async function setLocalServerEnabled(enabled: boolean) {
  await save({ ...(await readSaved()), enabled })
  if (enabled) await startLocalServer()
  else stopLocalServer()
  return localServerStatus()
}

/**
 * `--enable-local-server` (the owner's setup cmd): switch the mode on for good and open the site once the
 * server runs. Saved first, so it survives a restart with administrator rights.
 */
export async function enableFromCommandLine(argv: string[]) {
  if (argv.includes('--enable-local-server')) await save({ ...(await readSaved()), enabled: true, openSite: true })
  else if (isServerMode(argv)) await save({ ...(await readSaved()), enabled: true })
}

/**
 * `--server-mode` (the laptop that keeps the server on, Server-Laptop-Setup.cmd): only the server, the site and the
 * public link — no overlays, screen reading or game hotkeys, no administrator prompt, the window starts minimized.
 */
export function isServerMode(argv: string[] = process.argv) {
  return argv.includes('--server-mode')
}

/** Starts the server and site when the mode is on; true once when the site should be opened in the browser. */
export async function startIfEnabled() {
  const saved = await readSaved()
  if (saved.enabled !== true) return false
  await startLocalServer()
  if (!saved.openSite) return false
  await save({ ...saved, openSite: false })
  return siteState === 'running' || siteState === 'external'
}

export async function localServerStatus(): Promise<LocalServerStatus> {
  return { enabled: await localServerEnabled(), api: apiState, site: siteState, siteUrl: LOCAL_SITE_URL, database: databasePath(), ...(lastError ? { error: lastError } : {}) }
}

/** Something already answers on the port (e.g. scripts/start-local.ps1 from the repository). */
function portTaken(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    const done = (taken: boolean) => { socket.destroy(); resolve(taken) }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(600, () => done(false))
  })
}

export async function startLocalServer() {
  lastError = ''
  await mkdir(join(dataDir(), 'logs'), { recursive: true })
  if (!apiProcess) {
    if (await portTaken(API_PORT)) apiState = 'external'
    else if (!existsSync(serverScript())) { apiState = 'error'; lastError = 'Сервер не входит в эту сборку приложения.' }
    else await startApi()
  }
  if (!siteServer) {
    if (await portTaken(SITE_PORT)) siteState = 'external'
    else await startSite().catch((error: unknown) => { siteState = 'error'; lastError = error instanceof Error ? error.message : String(error) })
  }
  return localServerStatus()
}

async function startApi() {
  const log = join(dataDir(), 'logs', 'api.log')
  // Owner token, ЮKassa settings and the public address travel only in the process environment (electron/ownerAdmin.ts).
  const extra = await apiEnvironment(await publicSiteUrl())
  const child = utilityProcess.fork(serverScript(), [], {
    serviceName: 'Raid OS API',
    stdio: 'pipe',
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(API_PORT), TARKOV_DB_PATH: databasePath(), WEB_ORIGIN, ...extra },
  })
  const write = (chunk: Buffer) => void appendFile(log, chunk).catch(() => {})
  child.stdout?.on('data', write)
  child.stderr?.on('data', write)
  child.once('spawn', () => { apiState = 'running' })
  child.once('exit', (code) => {
    if (apiProcess === child) apiProcess = null
    apiState = code === 0 ? 'stopped' : 'error'
    if (code) lastError = `Сервер остановился с кодом ${code}. Журнал: ${log}`
  })
  apiProcess = child
  apiState = 'running'
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
}

/** The website as static files, every unknown path answered with index.html (client-side routes like /cabinet). */
function startSite() {
  return new Promise<void>((resolve, reject) => {
    const root = siteRoot()
    const server = createServer((request, response) => {
      void (async () => {
        const path = decodeURIComponent(new URL(request.url ?? '/', LOCAL_SITE_URL).pathname)
        if (path === '/download/windows') return sendDownload(response)
        if (path === '/download/version.json') return sendVersion(response)
        // The API under the site's own address: the site keeps working when opened through the public link.
        // The owner's admin API is for this PC's app only, never through the site or the public link.
        if (/^\/+v1\/+admin(\/|$)/i.test(path.replace(/\\/g, '/'))) { response.writeHead(404); response.end(); return }
        if (path === '/health' || path.startsWith('/v1/')) return proxyToApi(request, response)
        const file = normalize(join(root, path))
        const inside = file.startsWith(root + sep)
        const info = inside ? await stat(file).catch(() => null) : null
        const target = info?.isFile() ? file : join(root, 'index.html')
        const body = await readFile(target)
        response.writeHead(200, { 'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream', 'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' })
        response.end(body)
      })().catch(() => { response.writeHead(500); response.end() })
    })
    server.once('error', reject)
    server.listen(SITE_PORT, '127.0.0.1', () => { siteServer = server; siteState = 'running'; resolve() })
  })
}

function proxyToApi(request: IncomingMessage, response: ServerResponse) {
  const upstream = httpRequest({ host: '127.0.0.1', port: API_PORT, method: request.method, path: request.url, headers: { ...request.headers, host: `127.0.0.1:${API_PORT}` } }, (answer) => {
    response.writeHead(answer.statusCode ?? 502, answer.headers)
    answer.pipe(response)
  })
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'Сервер не запущен' }))
  })
  request.pipe(upstream)
}

interface Published { exe: string; info: { version: string; build: number; commit: string; edition: BuildEdition } | null }

/**
 * What «Скачать для Windows» and auto-update hand out: the players' (client) exe.
 * - The owner publishes it next to the server exe: `<server exe folder>\client\*.exe` with `version.json`
 *   ({ version, build, commit } of that build), put there by Server-Laptop-Setup.cmd (scripts/split-exe-for-chat.sh).
 *   TARKOV_CLIENT_DIR overrides the folder.
 * - Without it, the running exe, but only when it is itself a client build: the owner's own app is never handed out.
 */
async function publishedClient(): Promise<Published | null> {
  const running = process.env.PORTABLE_EXECUTABLE_FILE
  const dir = process.env.TARKOV_CLIENT_DIR?.trim() || (running ? join(dirname(running), 'client') : '')
  if (dir) {
    const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.toLowerCase().endsWith('.exe'))
    // Normally one exe; with several the newest one.
    const dated = await Promise.all(names.map(async (name) => ({ name, time: (await stat(join(dir, name)).catch(() => null))?.mtimeMs ?? 0 })))
    const newest = dated.sort((a, b) => a.time - b.time).at(-1)?.name
    if (newest) {
      let info: Published['info'] = null
      try {
        const raw = JSON.parse(await readFile(join(dir, 'version.json'), 'utf8')) as { version?: unknown; build?: unknown; commit?: unknown }
        if (Number(raw.build) > 0) info = { version: String(raw.version ?? ''), build: Number(raw.build), commit: String(raw.commit ?? ''), edition: 'client' }
      } catch { /* no version.json: downloads work, auto-update does not */ }
      return { exe: join(dir, newest), info }
    }
  }
  if (!running || !existsSync(running) || buildEdition() !== 'client') return null
  return { exe: running, info: await runningBuild() }
}

/** «Скачать для Windows» on the site: the players' exe (see publishedClient). */
function sendDownload(response: ServerResponse) {
  void publishedClient().then((published) => {
    if (!published) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Версия приложения для игроков ещё не опубликована на этом сервере.')
      return
    }
    streamExe(response, published.exe)
  }, () => { response.writeHead(500); response.end() })
}

function streamExe(response: ServerResponse, exe: string) {
  const name = basename(exe)
  void stat(exe).then((info) => {
    response.writeHead(200, {
      'content-type': 'application/vnd.microsoft.portable-executable',
      'content-length': String(info.size),
      'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    })
    createReadStream(exe).pipe(response)
  }, () => { response.writeHead(404); response.end() })
}

/** The build this app runs (scripts/write-build-info.mjs); build 0 in development. */
export async function runningBuild(): Promise<{ version: string; build: number; commit: string; trialLaunches: number; edition: BuildEdition }> {
  try {
    const info = JSON.parse(await readFile(join(appDir, '..', 'build-info.json'), 'utf8')) as { version?: unknown; build?: unknown; commit?: unknown; trialLaunches?: unknown }
    return { version: String(info.version ?? app.getVersion()), build: Number(info.build) || 0, commit: String(info.commit ?? ''), trialLaunches: Math.max(0, Math.floor(Number(info.trialLaunches) || 0)), edition: buildEdition() }
  } catch {
    return { version: app.getVersion(), build: 0, commit: '', trialLaunches: 0, edition: buildEdition() }
  }
}

let exeHash: { key: string; sha256: string } | null = null

async function hashFile(file: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Auto-update (electron/appUpdate.ts): which build the site hands out, with the exe's size, SHA-256 and edition. */
function sendVersion(response: ServerResponse) {
  void (async () => {
    const published = await publishedClient()
    if (!published?.info) { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}'); return }
    const { exe } = published
    const info = await stat(exe)
    const key = `${exe}:${info.size}:${info.mtimeMs}`
    if (exeHash?.key !== key) exeHash = { key, sha256: await hashFile(exe) }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
    const { version, build, commit, edition } = published.info
    response.end(JSON.stringify({ version, build, commit, edition, size: info.size, sha256: exeHash.sha256 }))
  })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end() })
}

/** New payment settings or public address: restart only the API (the site and the public link keep running). */
export async function restartApi() {
  if (!apiProcess) return localServerStatus()
  const old = apiProcess
  apiProcess = null
  await new Promise<void>((resolve) => { old.once('exit', () => resolve()); old.kill(); setTimeout(resolve, 3000) })
  lastError = ''
  await startApi()
  return localServerStatus()
}

export function stopLocalServer() {
  apiProcess?.kill()
  apiProcess = null
  siteServer?.close()
  siteServer = null
  apiState = 'stopped'
  siteState = 'stopped'
}
