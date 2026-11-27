// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const runElevated = vi.hoisted(() => vi.fn<(file: string, params: string, dir: string) => boolean>(() => true))
const nativeOk = vi.hoisted(() => vi.fn<() => boolean>(() => true))
const data = vi.hoisted(() => ({ folder: '' }))
vi.mock('./win32.js', () => ({ isElevated: () => false, runElevated }))
vi.mock('./nativeIntegrity.js', () => ({ nativeFilesTrustworthy: nativeOk }))
vi.mock('electron', () => ({ app: { quit: vi.fn(), getPath: () => data.folder } }))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const argv = process.argv
Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
afterAll(() => {
  Object.defineProperty(process, 'platform', platform)
  process.argv = argv
  delete process.env.PORTABLE_EXECUTABLE_FILE
  rmSync(data.folder, { recursive: true, force: true })
})

const { relaunchAsAdmin } = await import('./elevation')
const { noteShownStart, SANDBOX_BACK_AFTER } = await import('../gpuFallback')

beforeEach(() => {
  runElevated.mockClear()
  nativeOk.mockReturnValue(true)
  delete process.env.PORTABLE_EXECUTABLE_FILE
  if (data.folder) rmSync(data.folder, { recursive: true, force: true })
  data.folder = mkdtempSync(join(tmpdir(), 'raidos-elevation-'))
})

// Security review, 03.11.2026: whoever starts the app must not hand the copy with administrator rights anything but the
// app's own switches (Chromium's --remote-debugging-port would give that window away).
describe('the start with administrator rights', () => {
  // Security hardening: unpacked native modules (*.node) are outside the asar-integrity fuse, so a swapped one would run
  // elevated. relaunchAsAdmin checks them first and goes on without the rights when they do not match.
  it('does not elevate when a native module fails the integrity check', () => {
    nativeOk.mockReturnValueOnce(false)
    process.argv = ['C:\\Program Files\\RaidOS\\Raid OS.exe', '--server-mode', '--updated']
    expect(relaunchAsAdmin()).toBe(false)
    expect(runElevated).not.toHaveBeenCalled()
  })

  it('an installed copy passes on only its own switches, and who asked', () => {
    process.argv = ['C:\\Program Files\\RaidOS\\Raid OS.exe', '--server-mode', '--remote-debugging-port=9222', '--inspect', '--updated', '--js-flags=--allow-natives-syntax', 'C:\\x.html']
    expect(relaunchAsAdmin()).toBe(true)
    const [file, params] = runElevated.mock.calls[0]
    expect(file).toBe(process.execPath)
    expect(params).toBe(`--server-mode --updated --elevated-relaunch=${process.pid}`)
  })

  it('the portable exe is started again with nothing but who asked', () => {
    process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\Users\\p\\Downloads\\RaidOSClient.exe'
    process.argv = ['C:\\Temp\\ns1.tmp\\app\\Raid OS.exe', '--remote-debugging-port=9222']
    expect(relaunchAsAdmin()).toBe(true)
    expect(runElevated.mock.calls[0].slice(0, 2)).toEqual(['C:\\Users\\p\\Downloads\\RaidOSClient.exe', `--elevated-relaunch=${process.pid}`])
  })

  // Owner, 23.11.2026: a player's shortcut with --disable-gpu, then --no-sandbox, changed nothing — the copy with the rights
  // draws the window and never got them.
  it('the drawing switches of a dark window reach the copy with the rights, the portable exe too; nothing with a value', () => {
    process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\Users\\p\\Downloads\\RaidOSClient.exe'
    process.argv = ['C:\\Temp\\ns1.tmp\\app\\Raid OS.exe', '--disable-gpu', '--no-sandbox', '--disable-gpu', '--disable-gpu=1', '--no-sandbox-x', '--remote-debugging-port=9222']
    expect(relaunchAsAdmin()).toBe(true)
    expect(runElevated.mock.calls[0][1]).toBe(`--disable-gpu --no-sandbox --elevated-relaunch=${process.pid}`)
    delete process.env.PORTABLE_EXECUTABLE_FILE
    process.argv = ['C:\\Program Files\\RaidOS\\Raid OS.exe', '--updated', '--disable-gpu', '--inspect']
    expect(relaunchAsAdmin()).toBe(true)
    expect(runElevated.mock.calls[1][1]).toBe(`--updated --disable-gpu --elevated-relaunch=${process.pid}`)
  })

  // Security review, 27.11.2026: without the sandbox for a while only. After SANDBOX_BACK_AFTER starts of the copy with the
  // rights that showed their window, the shortcut's --no-sandbox is not handed on any more; --disable-gpu always is.
  it('hands the shortcut\'s --no-sandbox on for a few shown starts only, --disable-gpu always', () => {
    const shortcut = ['C:\\Program Files\\RaidOS\\Raid OS.exe', '--disable-gpu', '--no-sandbox']
    for (let start = 1; start <= SANDBOX_BACK_AFTER; start += 1) {
      process.argv = shortcut
      expect(relaunchAsAdmin()).toBe(true)
      expect(runElevated.mock.calls.at(-1)![1]).toBe(`--disable-gpu --no-sandbox --elevated-relaunch=${process.pid}`)
      // The copy with the rights showed its window (main.ts noteShownWindow).
      noteShownStart(data.folder, { noSandbox: false, noSandboxByArgument: true })
    }
    process.argv = shortcut
    expect(relaunchAsAdmin()).toBe(true)
    expect(runElevated.mock.calls.at(-1)![1]).toBe(`--disable-gpu --elevated-relaunch=${process.pid}`)
    // The portable exe the same.
    process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\Users\\p\\Downloads\\RaidOSClient.exe'
    expect(relaunchAsAdmin()).toBe(true)
    expect(runElevated.mock.calls.at(-1)![1]).toBe(`--disable-gpu --elevated-relaunch=${process.pid}`)
  })
})
