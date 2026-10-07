import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { basename, extname, join, normalize, sep } from 'node:path'
import { proxyToApi, siteRoute } from '../siteProxy.js'
import { siteSecurityHeaders } from '../siteHeaders.js'

/**
 * The website on the Linux server (docs/linux-server.md): what electron/localServer.ts does on the Windows laptop,
 * without Electron. Static files with every unknown path answered by index.html, /health and /v1/* forwarded to the
 * API (the owner's /v1/admin never), «Скачать для Windows» and the players' signed version.json from the client folder
 * the updater fills (electron/linux/updater.ts). Caddy in front of it terminates HTTPS and sets CF-Connecting-IP to the
 * visitor's address (siteProxy.ts passes it on to the API's per-IP limits).
 *
 * Environment: SITE_PORT (5202), API_PORT (8787), SITE_ROOT (the built website), CLIENT_DIR (players' exe + version.json).
 */
export interface SiteOptions { port: number; apiPort: number; root: string; clientDir: string; host?: string }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
}

interface ClientInfo { version: string; build: number; commit: string; edition: 'client'; signature: string }

/** The newest players' exe in the client folder and its signed version.json (null when nothing usable is there). */
export async function publishedClient(dir: string): Promise<{ exe: string; info: ClientInfo | null } | null> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.toLowerCase().endsWith('.exe'))
  const dated = await Promise.all(names.map(async (name) => ({ name, time: (await stat(join(dir, name)).catch(() => null))?.mtimeMs ?? 0 })))
  const newest = dated.sort((a, b) => a.time - b.time).at(-1)?.name
  if (!newest) return null
  let info: ClientInfo | null = null
  try {
    const raw = JSON.parse(await readFile(join(dir, 'version.json'), 'utf8')) as Record<string, unknown>
    if (Number(raw.build) > 0 && typeof raw.signature === 'string') {
      info = { version: String(raw.version ?? ''), build: Number(raw.build), commit: String(raw.commit ?? ''), edition: 'client', signature: raw.signature }
    }
  } catch { /* no version.json: the download works, auto-update is not offered */ }
  return { exe: join(dir, newest), info }
}

let exeHash: { key: string; sha256: string } | null = null
async function hashFile(file: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function sendDownload(response: ServerResponse, clientDir: string) {
  const published = await publishedClient(clientDir)
  if (!published) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Версия приложения для игроков ещё не опубликована на этом сервере.')
    return
  }
  const info = await stat(published.exe)
  const name = basename(published.exe)
  response.writeHead(200, {
    'content-type': 'application/vnd.microsoft.portable-executable',
    'content-length': String(info.size),
    'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  })
  createReadStream(published.exe).pipe(response)
}

/** Players' auto-update: the signed fields plus size and SHA-256 of the exe really there (as on the laptop). */
async function sendVersion(response: ServerResponse, clientDir: string) {
  const published = await publishedClient(clientDir)
  if (!published?.info) { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}'); return }
  const info = await stat(published.exe)
  const key = `${published.exe}:${info.size}:${info.mtimeMs}`
  if (exeHash?.key !== key) exeHash = { key, sha256: await hashFile(published.exe) }
  const { version, build, commit, edition, signature } = published.info
  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
  response.end(JSON.stringify({ version, build, commit, edition, size: info.size, sha256: exeHash.sha256, signature }))
}

export function createSiteServer(options: SiteOptions): Server {
  const root = normalize(options.root)
  return createServer((request, response) => {
    for (const [name, value] of Object.entries(siteSecurityHeaders())) response.setHeader(name, value)
    void (async () => {
      let path: string
      try { path = decodeURIComponent(new URL(request.url ?? '/', 'http://site.invalid').pathname) } catch { response.writeHead(400); response.end(); return }
      if (path === '/download/windows') return sendDownload(response, options.clientDir)
      if (path === '/download/version.json') return sendVersion(response, options.clientDir)
      const route = siteRoute(path)
      if (route === 'blocked') { response.writeHead(404); response.end(); return }
      if (route === 'api') return proxyToApi(request, response, options.apiPort, path)
      const file = normalize(join(root, path))
      const inside = file.startsWith(root + sep)
      const info = inside ? await stat(file).catch(() => null) : null
      const target = info?.isFile() ? file : join(root, 'index.html')
      const body = await readFile(target)
      response.writeHead(200, { 'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream', 'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' })
      response.end(body)
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end() })
  })
}

/** Entry point of site-server.cjs (scripts/build-linux-server.mjs). */
export function main(env: NodeJS.ProcessEnv = process.env) {
  const options: SiteOptions = {
    port: Number(env.SITE_PORT ?? 5202),
    apiPort: Number(env.API_PORT ?? 8787),
    root: env.SITE_ROOT ?? '/opt/raidos/current/site/www',
    clientDir: env.CLIENT_DIR ?? '/var/lib/raidos/client',
    host: env.SITE_HOST ?? '127.0.0.1',
  }
  const server = createSiteServer(options)
  server.listen(options.port, options.host, () => console.log(`Raid OS site on http://${options.host}:${options.port} (root ${options.root}, API ${options.apiPort})`))
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
