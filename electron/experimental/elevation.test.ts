// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const runElevated = vi.hoisted(() => vi.fn((_file: string, _params: string, _dir: string) => true))
vi.mock('./win32.js', () => ({ isElevated: () => false, runElevated }))
vi.mock('electron', () => ({ app: { quit: vi.fn() } }))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const argv = process.argv
Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
afterAll(() => {
  Object.defineProperty(process, 'platform', platform)
  process.argv = argv
  delete process.env.PORTABLE_EXECUTABLE_FILE
})

const { relaunchAsAdmin } = await import('./elevation')

beforeEach(() => {
  runElevated.mockClear()
  delete process.env.PORTABLE_EXECUTABLE_FILE
})

// Security review, 03.11.2026: whoever starts the app must not hand the copy with administrator rights anything but the
// app's own switches (Chromium's --remote-debugging-port would give that window away).
describe('the start with administrator rights', () => {
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
})
