// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => env.userData }, safeStorage: { isEncryptionAvailable: () => false } }))
const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn }))

const { CLOUDFLARED, cloudflaredVerified, setTunnel, stopTunnel, tunnelHosts, tunnelStatus } = await import('./publicTunnel')

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
Object.defineProperty(process, 'platform', { ...platform, value: 'win32' }) // the tunnel runs only on Windows
env.userData = mkdtempSync(join(tmpdir(), 'raidos-tunnel-'))
const tools = join(env.userData, 'tools')
const exe = join(tools, 'cloudflared.exe')
afterAll(() => { Object.defineProperty(process, 'platform', platform); rmSync(env.userData, { recursive: true, force: true }) })

const pinned = { sha256: CLOUDFLARED.sha256 }
const release = Buffer.from('MZ the pinned cloudflared release (test bytes)')
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const download = { body: Buffer.from('MZ this is not the pinned cloudflared'), status: 200 }
const fetchMock = vi.fn(async () => new Response(new Uint8Array(download.body), { status: download.status }))
vi.stubGlobal('fetch', fetchMock)
const child = async () => Object.assign(new (await import('node:events')).EventEmitter(), { stdout: null, stderr: null, kill: vi.fn() })

describe('cloudflared download (electron/publicTunnel.ts)', () => {
  beforeEach(() => {
    stopTunnel(); fetchMock.mockClear(); spawn.mockReset()
    rmSync(tools, { recursive: true, force: true })
    download.body = Buffer.from('MZ this is not the pinned cloudflared')
    download.status = 200
  })
  afterEach(() => { CLOUDFLARED.sha256 = pinned.sha256 })

  it('downloads the pinned release and deletes a file whose SHA-256 does not match, without starting it', async () => {
    const status = await setTunnel(true)
    expect(fetchMock).toHaveBeenCalledWith('https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-windows-amd64.exe', expect.anything())
    expect(status.state).toBe('error')
    expect(status.error).toMatch(/SHA-256/)
    expect(spawn).not.toHaveBeenCalled()
    expect(readdirSync(tools)).toEqual([])
  })

  // Security review, 27.11.2026: the file lies in the app's data folder and the app starts it with administrator rights.
  it('starts a cloudflared.exe already there only when it is the pinned release', async () => {
    CLOUDFLARED.sha256 = sha256(release)
    mkdirSync(tools, { recursive: true })
    writeFileSync(exe, release)
    spawn.mockReturnValue(await child())
    await setTunnel(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledWith(exe, expect.arrayContaining(['tunnel', '--url']), expect.anything())
    expect((await tunnelStatus()).state).toBe('starting')
  })

  it('a copy that is not the pinned release (an earlier version\'s, or changed) is downloaded again and only then started', async () => {
    CLOUDFLARED.sha256 = sha256(release)
    mkdirSync(tools, { recursive: true })
    writeFileSync(exe, 'MZ downloaded by an earlier version')
    download.body = release
    spawn.mockReturnValue(await child())
    await setTunnel(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readFileSync(exe)).toEqual(release)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0]![0]).toBe(exe)
  })

  it('a changed copy and no download: a clear error, nothing started, the changed file gone', async () => {
    CLOUDFLARED.sha256 = sha256(release)
    mkdirSync(tools, { recursive: true })
    writeFileSync(exe, 'MZ changed after the download')
    download.status = 404
    const status = await setTunnel(true)
    expect(status.state).toBe('error')
    expect(status.error).toMatch(/Не удалось скачать cloudflared/)
    expect(spawn).not.toHaveBeenCalled()
    expect(existsSync(exe)).toBe(false)
  })

  it('checks the very bytes: one changed byte is not the release', () => {
    CLOUDFLARED.sha256 = sha256(release)
    mkdirSync(tools, { recursive: true })
    writeFileSync(exe, release)
    expect(cloudflaredVerified(exe)).toBe(true)
    const changed = Buffer.from(release)
    changed[changed.length - 1] ^= 1
    writeFileSync(exe, changed)
    expect(cloudflaredVerified(exe)).toBe(false)
    rmSync(exe)
    expect(cloudflaredVerified(exe)).toBe(false)
  })
})

// Security review, 27.11.2026: the site on this PC answers only its own names and these (localServer.ts, siteProxy.ts).
describe('the names the public link reaches the site by (tunnelHosts)', () => {
  beforeEach(() => { stopTunnel(); spawn.mockReset(); rmSync(join(env.userData, 'public-tunnel.json'), { force: true }) })
  afterEach(() => { CLOUDFLARED.sha256 = pinned.sha256 })

  it('none without a link; the permanent address with and without «www.», also while this app runs no tunnel', async () => {
    await setTunnel(false)
    expect(await tunnelHosts()).toEqual([])
    writeFileSync(join(env.userData, 'public-tunnel.json'), JSON.stringify({ hostname: 'Tarkov.Example.com' }))
    await setTunnel(false) // saving drops the names read before
    expect(await tunnelHosts()).toEqual(['tarkov.example.com', 'www.tarkov.example.com'])
    writeFileSync(join(env.userData, 'public-tunnel.json'), JSON.stringify({ hostname: 'not a host name' }))
    await setTunnel(false)
    expect(await tunnelHosts()).toEqual([])
  })

  it('the free link only while this app\'s tunnel runs', async () => {
    CLOUDFLARED.sha256 = sha256(release)
    mkdirSync(tools, { recursive: true })
    writeFileSync(exe, release)
    const { EventEmitter } = await import('node:events')
    const output = new EventEmitter()
    spawn.mockReturnValue(Object.assign(new EventEmitter(), { stdout: output, stderr: null, kill: vi.fn() }))
    await setTunnel(true)
    output.emit('data', Buffer.from('INF |  https://quiet-river-1234.trycloudflare.com  |'))
    expect((await tunnelStatus()).state).toBe('on')
    expect(await tunnelHosts()).toEqual(['quiet-river-1234.trycloudflare.com'])
    stopTunnel()
    expect(await tunnelHosts()).toEqual([])
  })
})
