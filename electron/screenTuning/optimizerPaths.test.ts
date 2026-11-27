// @vitest-environment node
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review, 27.11.2026: «Оптимизировать компьютер» runs reg.exe, powercfg.exe and PowerShell with the app's
 * administrator rights. Each is System32's by its full path (electron/windowsSystem.ts), PowerShell looks for modules in
 * the folders only administrators may write, and the video card's app is looked for in Windows' own Program Files, never
 * %ProgramFiles%.
 */
const execFile = vi.hoisted(() => vi.fn((_file: string, _args: string[], _options: { env?: Record<string, string> }, done: (error: Error | null, stdout: string) => void) => done(null, '')))
vi.mock('node:child_process', () => ({ execFile }))

const { defaultRun, elevatedApplyScript, elevatedRevertScript, elevatedRunner, optimizeOpenTarget, optimizeStatus } = await import('./optimizer')
const { powershellExe, systemEnvironment, systemProgram, windowsDirectory } = await import('../windowsSystem')

const decode = (base64: string) => Buffer.from(base64, 'base64').toString('utf16le')
const saved = { PSModulePath: process.env.PSModulePath, SystemRoot: process.env.SystemRoot }
afterEach(() => { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value } })

describe('the optimizer\'s programs (electron/screenTuning/optimizer.ts)', () => {
  it('reads Windows\' settings with System32\'s reg.exe, powercfg.exe and tasklist.exe by their full path', async () => {
    // optimizeStatus reads nothing off Windows, and the release gate runs on Linux: the test stands in for Windows
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
    try {
      const files: string[] = []
      await optimizeStatus(async (file) => { files.push(file); throw new Error('not here') }, false, null, null).catch(() => undefined)
      expect(files.length).toBeGreaterThan(0)
      for (const file of files) expect([systemProgram('reg.exe'), systemProgram('powercfg.exe'), systemProgram('tasklist.exe')]).toContain(file)
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it('every program it starts gets Windows\' own %SystemRoot% and a PSModulePath without the player\'s Documents', async () => {
    process.env.PSModulePath = 'C:\\Users\\p\\Documents\\WindowsPowerShell\\Modules;C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules'
    process.env.SystemRoot = 'C:\\Users\\p\\fake'
    await defaultRun(powershellExe(), ['-NoProfile'])
    const [file, , options] = execFile.mock.calls.at(-1)!
    expect(file).toBe(powershellExe())
    expect(options.env?.SystemRoot).toBe(windowsDirectory())
    expect(options.env?.PSModulePath).toBe(systemEnvironment().PSModulePath)
    expect(options.env?.PSModulePath).not.toMatch(/Documents/i)
  })

  it('the administrator steps: PowerShell and reg.exe of System32 by their full path, modules from the administrators\' folders first', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const result = await elevatedRunner(async (file, args) => { calls.push({ file, args }); return '' }, join(process.cwd(), 'no-such-folder'))(elevatedApplyScript(['gpuScheduling']))
    expect(result).toBeNull() // nothing was written: the test runs nothing
    expect(calls).toHaveLength(1)
    expect(calls[0]!.file).toBe(powershellExe())
    const outer = decode(calls[0]!.args.at(-1)!)
    expect(outer).toContain(`Start-Process -FilePath '${powershellExe()}' -Verb RunAs`)
    expect(outer).not.toContain("-FilePath 'powershell.exe'")
    const inner = decode(/'-EncodedCommand', '([A-Za-z0-9+/=]+)'/.exec(outer)![1]!)
    expect(inner.split('\n')[0]).toBe(`$env:PSModulePath = '${systemEnvironment().PSModulePath}'`)
    expect(inner).toContain(`& '${systemProgram('reg.exe')}' add 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' /v HwSchMode /t REG_DWORD /d 2 /f`)
    for (const script of [elevatedApplyScript(['gpuScheduling']), elevatedRevertScript({ gpuScheduling: null }), elevatedRevertScript({ gpuScheduling: 1 })]) {
      expect(script).not.toMatch(/& reg\.exe/)
      expect(script).toContain(`& '${systemProgram('reg.exe')}'`)
    }
  })

  it('the video card\'s app is looked for in the Program Files given; anything else asked for opens nothing', () => {
    expect(optimizeOpenTarget('nvidia-app', 'D:\\Programs')).toEqual({ exe: join('D:\\Programs', 'NVIDIA Corporation', 'NVIDIA App', 'CEF', 'NVIDIA App.exe'), url: 'https://www.nvidia.com/ru-ru/software/nvidia-app/' })
    expect(optimizeOpenTarget('amd-software', 'D:\\Programs')?.exe).toBe(join('D:\\Programs', 'AMD', 'CNext', 'CNext', 'RadeonSoftware.exe'))
    expect(optimizeOpenTarget('nvidia-driver', 'D:\\Programs')).toEqual({ url: 'https://www.nvidia.com/ru-ru/geforce/drivers/' })
    for (const other of ['toString', '__proto__', 'calc', 1, null]) expect(optimizeOpenTarget(other, 'D:\\Programs')).toBeUndefined()
  })
})
