// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => env.userData }, safeStorage: { isEncryptionAvailable: () => false } }))
const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn }))

const { setTunnel, stopTunnel, tunnelStatus } = await import('./publicTunnel')

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
Object.defineProperty(process, 'platform', { ...platform, value: 'win32' }) // the tunnel runs only on Windows
env.userData = mkdtempSync(join(tmpdir(), 'raidos-tunnel-'))
const tools = join(env.userData, 'tools')
afterAll(() => { Object.defineProperty(process, 'platform', platform); rmSync(env.userData, { recursive: true, force: true }) })

const fetchMock = vi.fn(async () => new Response('MZ this is not the pinned cloudflared'))
vi.stubGlobal('fetch', fetchMock)

describe('cloudflared download (electron/publicTunnel.ts)', () => {
  beforeEach(() => { stopTunnel(); fetchMock.mockClear(); spawn.mockReset() })

  it('downloads the pinned release and deletes a file whose SHA-256 does not match, without starting it', async () => {
    const status = await setTunnel(true)
    expect(fetchMock).toHaveBeenCalledWith('https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-windows-amd64.exe', expect.anything())
    expect(status.state).toBe('error')
    expect(status.error).toMatch(/SHA-256/)
    expect(spawn).not.toHaveBeenCalled()
    expect(readdirSync(tools)).toEqual([])
  })

  it('keeps using a cloudflared.exe that is already there', async () => {
    mkdirSync(tools, { recursive: true })
    writeFileSync(join(tools, 'cloudflared.exe'), 'MZ downloaded by an earlier version')
    const child = Object.assign(new (await import('node:events')).EventEmitter(), { stdout: null, stderr: null, kill: vi.fn() })
    spawn.mockReturnValue(child)
    await setTunnel(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledWith(join(tools, 'cloudflared.exe'), expect.arrayContaining(['tunnel', '--url']), expect.anything())
    expect(existsSync(join(tools, 'cloudflared.exe'))).toBe(true)
    expect((await tunnelStatus()).state).toBe('starting')
  })
})
