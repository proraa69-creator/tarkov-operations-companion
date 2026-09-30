import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * «Открыть сайт друзьям»: a Cloudflare quick tunnel (cloudflared, free, no account) gives the site on this
 * PC a public https link — the site and, through it, the API (/v1, see localServer.ts). The owner turns it
 * on explicitly; cloudflared.exe is downloaded once from Cloudflare's GitHub releases into the app data folder.
 * The link changes every time the tunnel starts.
 */
const CLOUDFLARED_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
const SITE = 'http://127.0.0.1:5202'
const LINK = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i

export type TunnelState = 'off' | 'downloading' | 'starting' | 'on' | 'error'
export interface TunnelStatus { state: TunnelState; url?: string; error?: string; autoStart: boolean }

let child: ChildProcess | null = null
let state: TunnelState = 'off'
let url = ''
let error = ''

const toolsDir = () => join(app.getPath('userData'), 'tools')
const exePath = () => join(toolsDir(), 'cloudflared.exe')
const settingsFile = () => join(app.getPath('userData'), 'public-tunnel.json')

async function autoStart() {
  try {
    return (JSON.parse(await readFile(settingsFile(), 'utf8')) as { autoStart?: unknown }).autoStart === true
  } catch {
    return false
  }
}

export async function tunnelStatus(): Promise<TunnelStatus> {
  return { state, ...(url ? { url } : {}), ...(error ? { error } : {}), autoStart: await autoStart() }
}

/** On/off; the choice is remembered so an always-on PC (e.g. a laptop running the server) opens it on start. */
export async function setTunnel(enabled: boolean) {
  await writeFile(settingsFile(), JSON.stringify({ autoStart: enabled }), 'utf8').catch(() => {})
  if (enabled) await startTunnel()
  else stopTunnel()
  return tunnelStatus()
}

/** `--enable-tunnel` (Server-Laptop-Setup.cmd): the public link is opened on every start from now on. */
export async function enableTunnelFromCommandLine(argv: string[]) {
  if (argv.includes('--enable-tunnel')) await writeFile(settingsFile(), JSON.stringify({ autoStart: true }), 'utf8').catch(() => {})
}

export async function startTunnelIfWanted() {
  if (await autoStart()) await startTunnel()
}

async function ensureCloudflared() {
  if (existsSync(exePath())) return exePath()
  state = 'downloading'
  await mkdir(toolsDir(), { recursive: true })
  const response = await fetch(CLOUDFLARED_URL, { redirect: 'follow', signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`Не удалось скачать cloudflared: HTTP ${response.status}`)
  const partial = `${exePath()}.part`
  await writeFile(partial, Buffer.from(await response.arrayBuffer()))
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
    state = 'starting'
    const next = spawn(exe, ['tunnel', '--no-autoupdate', '--url', SITE], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const read = (chunk: Buffer) => {
      const found = LINK.exec(chunk.toString())
      if (found && !url) { url = found[0]; state = 'on' }
    }
    next.stdout?.on('data', read)
    next.stderr?.on('data', read)
    next.once('exit', (code) => {
      if (child === next) child = null
      if (state !== 'off') { state = 'error'; error = `Туннель остановился (код ${code ?? '—'}).`; url = '' }
    })
    next.once('error', (reason) => { state = 'error'; error = reason.message })
    child = next
  } catch (reason) {
    state = 'error'
    error = reason instanceof Error ? reason.message : String(reason)
    await rm(`${exePath()}.part`, { force: true }).catch(() => {})
  }
}

export function stopTunnel() {
  state = 'off'
  url = ''
  child?.kill()
  child = null
}
