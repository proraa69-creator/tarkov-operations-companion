import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'

/**
 * «Открыть сайт друзьям»: a Cloudflare quick tunnel (cloudflared, free, no account) gives the site on this
 * PC a public https link — the site and, through it, the API (/v1, see localServer.ts). The owner turns it
 * on explicitly; cloudflared.exe is downloaded once from Cloudflare's GitHub releases into the app data folder: a pinned
 * release, checked against its SHA-256 before it is ever started (a copy downloaded earlier is kept as it is).
 * The link changes every time the tunnel starts.
 *
 * Permanent address: the owner creates a named tunnel in their own Cloudflare account (their domain, public hostname
 * → http://127.0.0.1:5202) and pastes its token here. The token is a secret: kept encrypted with safeStorage, never
 * sent to the renderer or logged, and handed to cloudflared through the TUNNEL_TOKEN environment variable (not the
 * command line, which other programs can read).
 */
/**
 * cloudflared-windows-amd64.exe of a pinned release and its SHA-256 (55 366 080 bytes; the file is Authenticode-signed
 * by «Cloudflare, Inc.», DigiCert chain, signature checked when the hash was taken). To move to a newer release, change
 * both together.
 */
const CLOUDFLARED_VERSION = '2026.9.3'
const CLOUDFLARED_URL = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe`
const CLOUDFLARED_SHA256 = 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2'
const SITE = 'http://127.0.0.1:5202'
const LINK = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i

export type TunnelState = 'off' | 'downloading' | 'starting' | 'on' | 'error'
export interface TunnelStatus { state: TunnelState; url?: string; error?: string; autoStart: boolean; /** A permanent address is set up. */ hostname?: string }

let child: ChildProcess | null = null
let state: TunnelState = 'off'
let url = ''
let error = ''

const toolsDir = () => join(app.getPath('userData'), 'tools')
const exePath = () => join(toolsDir(), 'cloudflared.exe')
const settingsFile = () => join(app.getPath('userData'), 'public-tunnel.json')
const tokenFile = () => join(app.getPath('userData'), 'public-tunnel-token.bin')

interface Saved { autoStart?: boolean; hostname?: string }

async function readSaved(): Promise<Saved> {
  try {
    return JSON.parse(await readFile(settingsFile(), 'utf8')) as Saved
  } catch {
    return {}
  }
}

async function save(next: Saved) {
  await writeFile(settingsFile(), JSON.stringify(next), 'utf8').catch(() => {})
}

async function autoStart() {
  return (await readSaved()).autoStart === true
}

async function namedTunnel(): Promise<{ hostname: string; token: string } | null> {
  const { hostname } = await readSaved()
  if (!hostname || !existsSync(tokenFile())) return null
  try {
    return { hostname, token: safeStorage.decryptString(await readFile(tokenFile())) }
  } catch {
    return null
  }
}

/** The permanent public site address (https://hostname), or '' without one. */
export async function publicSiteUrl() {
  const { hostname } = await readSaved()
  return hostname ? `https://${hostname}` : ''
}

export async function tunnelStatus(): Promise<TunnelStatus> {
  const { hostname } = await readSaved()
  return { state, ...(url ? { url } : {}), ...(error ? { error } : {}), autoStart: await autoStart(), ...(hostname ? { hostname } : {}) }
}

const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const TOKEN = /^[A-Za-z0-9+/=_-]{40,2000}$/

/**
 * Permanent address from the owner's Cloudflare account: `hostname` (e.g. tarkov.example.com) and the tunnel token.
 * Empty values remove it (back to the free changing link). A running tunnel restarts with the new setting.
 */
export async function setNamedTunnel(rawHostname: unknown, rawToken: unknown) {
  const hostname = typeof rawHostname === 'string' ? rawHostname.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : ''
  // The dashboard shows it inside a command (`cloudflared service install eyJ…` / `--token eyJ…`): take the token itself.
  const rawText = typeof rawToken === 'string' ? rawToken.trim() : ''
  const token = /eyJ[A-Za-z0-9+/=_-]{30,}/.exec(rawText)?.[0] ?? rawText
  const saved = await readSaved()
  if (!hostname && !token) {
    await rm(tokenFile(), { force: true }).catch(() => {})
    await save({ ...saved, hostname: undefined })
  } else {
    if (!HOSTNAME.test(hostname)) throw new Error('Введите адрес вида tarkov.example.com')
    if (token) {
      if (!TOKEN.test(token)) throw new Error('Это не похоже на токен туннеля Cloudflare')
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows не даёт зашифровать токен на этом компьютере')
      await writeFile(tokenFile(), safeStorage.encryptString(token))
    } else if (!existsSync(tokenFile())) throw new Error('Вставьте токен туннеля')
    await save({ ...saved, hostname })
  }
  if (child) { stopTunnel(); await startTunnel() }
  return tunnelStatus()
}

/** On/off; the choice is remembered so an always-on PC (e.g. a laptop running the server) opens it on start. */
export async function setTunnel(enabled: boolean) {
  await save({ ...(await readSaved()), autoStart: enabled })
  if (enabled) await startTunnel()
  else stopTunnel()
  return tunnelStatus()
}

/** `--enable-tunnel` (Server-Laptop-Setup.cmd): the public link is opened on every start from now on. */
export async function enableTunnelFromCommandLine(argv: string[]) {
  if (argv.includes('--enable-tunnel')) await save({ ...(await readSaved()), autoStart: true })
}

export async function startTunnelIfWanted() {
  if (await autoStart()) await startTunnel()
}

async function ensureCloudflared() {
  // Already there (also a copy an earlier version of the app downloaded): used as it is.
  if (existsSync(exePath())) return exePath()
  state = 'downloading'
  await mkdir(toolsDir(), { recursive: true })
  const response = await fetch(CLOUDFLARED_URL, { redirect: 'follow', signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`Не удалось скачать cloudflared: HTTP ${response.status}`)
  const partial = `${exePath()}.part`
  const body = Buffer.from(await response.arrayBuffer())
  await writeFile(partial, body)
  if (createHash('sha256').update(body).digest('hex') !== CLOUDFLARED_SHA256) {
    await rm(partial, { force: true }).catch(() => {})
    throw new Error('Скачанный cloudflared не прошёл проверку SHA-256 и удалён. Попробуйте позже.')
  }
  await rename(partial, exePath())
  return exePath()
}

async function startTunnel() {
  if (child || process.platform !== 'win32') {
    if (process.platform !== 'win32') { state = 'error'; error = 'Туннель работает только в Windows.' }
    return
  }
  error = ''
  url = ''
  try {
    const exe = await ensureCloudflared()
    const named = await namedTunnel()
    state = 'starting'
    const next = named
      ? spawn(exe, ['tunnel', '--no-autoupdate', 'run'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TUNNEL_TOKEN: named.token } })
      : spawn(exe, ['tunnel', '--no-autoupdate', '--url', SITE], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const read = (chunk: Buffer) => {
      const text = chunk.toString()
      // cloudflared logs «ERR …» lines while it cannot reach Cloudflare or the site; the watchdog counts them.
      for (const line of text.split(/\r?\n/)) if (/\bERR\b/.test(line)) { errorLines.push(Date.now()); lastErrorLine = line.replace(/^\S+\s+ERR\s+/, '').slice(0, 200) }
      while (errorLines.length && errorLines[0] < Date.now() - 120_000) errorLines.shift()
      if (url) return
      if (named) { if (/Registered tunnel connection/i.test(text)) { url = `https://${named.hostname}`; state = 'on' } return }
      const found = LINK.exec(text)
      if (found) { url = found[0]; state = 'on' }
    }
    next.stdout?.on('data', read)
    next.stderr?.on('data', read)
    next.once('exit', (code) => {
      // An old process exiting after a restart must not mark the new one as failed.
      if (child !== next) return
      child = null
      if (state !== 'off') { state = 'error'; error = `Туннель остановился (код ${code ?? '—'}).`; url = '' }
    })
    next.once('error', (reason) => { if (child === next || child === null) { state = 'error'; error = reason.message } })
    child = next
  } catch (reason) {
    state = 'error'
    error = reason instanceof Error ? reason.message : String(reason)
    await rm(`${exePath()}.part`, { force: true }).catch(() => {})
  }
}

let errorLines: number[] = []
let lastErrorLine = ''

/** For the watchdog (electron/serverMonitor.ts): is cloudflared running, and its «ERR» lines in the last 2 minutes. */
export function tunnelProcess() {
  while (errorLines.length && errorLines[0] < Date.now() - 120_000) errorLines.shift()
  return { running: child !== null, recentErrors: errorLines.length, lastErrorLine }
}

/** Watchdog repair: stop cloudflared and start it again (only when the owner turned the link on). */
export async function restartTunnel() {
  if (!(await autoStart())) return tunnelStatus()
  stopTunnel()
  errorLines = []
  lastErrorLine = ''
  await startTunnel()
  return tunnelStatus()
}

export function stopTunnel() {
  state = 'off'
  url = ''
  child?.kill()
  child = null
}
