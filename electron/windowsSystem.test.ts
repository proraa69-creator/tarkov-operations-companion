// @vitest-environment node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { childEnvironment, createWindowsSystem, FALLBACK_SYSTEM_DIRECTORY, powershellExe, processElevated, programFilesDirectory, systemDirectory, systemEnvironment, systemProgram, type KoffiLibraries } from './windowsSystem'

/** A Windows on D: as Koffi would show it: what each function writes into its buffer and returns. */
function fakeKoffi(answers: { system?: string | null; programFiles?: string | null; admin?: number | Error }) {
  const write = (buffer: Uint16Array, text: string) => { for (let index = 0; index < text.length; index += 1) buffer[index] = text.charCodeAt(index); buffer[text.length] = 0 }
  const calls: string[] = []
  const koffi: KoffiLibraries = {
    load: (library) => ({
      func: (signature) => {
        const name = /__stdcall (\w+)\(/.exec(signature)?.[1] ?? ''
        calls.push(`${library}:${name}`)
        if (name === 'GetSystemDirectoryW') return (buffer: unknown) => { if (answers.system == null) return 0; write(buffer as Uint16Array, answers.system); return answers.system.length }
        if (name === 'SHGetFolderPathW') return (_hwnd: unknown, _csidl: unknown, _token: unknown, _flags: unknown, buffer: unknown) => { if (answers.programFiles == null) return 0x80070002; write(buffer as Uint16Array, answers.programFiles); return 0 }
        if (name === 'IsUserAnAdmin') return () => { if (answers.admin instanceof Error) throw answers.admin; return answers.admin ?? 0 }
        throw new Error(`no ${name}`)
      },
    }),
  }
  return { koffi, calls }
}

const saved = { ...process.env }
afterEach(() => { for (const name of ['SystemRoot', 'windir', 'ComSpec', 'ProgramFiles', 'PSModulePath']) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name] } })

// Security review, 27.11.2026: the app runs with administrator rights, and the environment must not decide which program
// it starts or whether it has those rights.
describe('Windows\' own folders and the rights (electron/windowsSystem.ts)', () => {
  it('asks Windows itself through Koffi, once, whatever the environment says', () => {
    const { koffi, calls } = fakeKoffi({ system: 'D:\\WIN\\system32', programFiles: 'D:\\Programs', admin: 1 })
    process.env.SystemRoot = 'C:\\Users\\p\\fake'
    process.env.ProgramFiles = 'C:\\Users\\p\\fake'
    const windows = createWindowsSystem(() => koffi)
    expect(windows.systemDirectory()).toBe('D:\\WIN\\system32')
    expect(windows.windowsDirectory()).toBe('D:\\WIN')
    expect(windows.programFilesDirectory()).toBe('D:\\Programs')
    expect(windows.elevated()).toBe(true)
    windows.systemDirectory(); windows.programFilesDirectory(); windows.elevated()
    expect(calls).toEqual(['kernel32.dll:GetSystemDirectoryW', 'shell32.dll:SHGetFolderPathW', 'shell32.dll:IsUserAnAdmin'])
    expect(createWindowsSystem(() => fakeKoffi({ admin: 0 }).koffi).elevated()).toBe(false)
  })

  it('without Koffi: drive C:\'s usual folders and rights unknown — never the environment', () => {
    process.env.SystemRoot = 'C:\\Users\\p\\fake'
    process.env.ProgramFiles = 'C:\\Users\\p\\fake'
    for (const load of [() => null, () => { throw new Error('Cannot find the native Koffi module') }]) {
      const windows = createWindowsSystem(load)
      expect(windows.systemDirectory()).toBe(FALLBACK_SYSTEM_DIRECTORY)
      expect(windows.windowsDirectory()).toBe('C:\\Windows')
      expect(windows.programFilesDirectory()).toBe('C:\\Program Files')
      expect(windows.elevated()).toBeNull()
    }
  })

  it('an answer that is no folder on a drive (empty, relative, a network share) or a failed call is not taken', () => {
    for (const system of [null, '', 'system32', '\\\\server\\share\\system32', '\\\\?\\C:\\Windows\\System32']) {
      expect(createWindowsSystem(() => fakeKoffi({ system }).koffi).systemDirectory()).toBe(FALLBACK_SYSTEM_DIRECTORY)
    }
    // Program Files on the system's drive when shell32 cannot say.
    expect(createWindowsSystem(() => fakeKoffi({ system: 'D:\\WIN\\system32', programFiles: null }).koffi).programFilesDirectory()).toBe('D:\\Program Files')
    expect(createWindowsSystem(() => fakeKoffi({ admin: new Error('no shell32') }).koffi).elevated()).toBeNull()
  })

  it('a child process gets the system variables from these folders, in any case they were written, and keeps the rest', () => {
    const windows = createWindowsSystem(() => fakeKoffi({ system: 'D:\\WIN\\system32', programFiles: 'D:\\Programs' }).koffi)
    const env = childEnvironment({ SYSTEMROOT: 'C:\\fake', windir: 'C:\\fake', comspec: 'C:\\fake\\cmd.exe', PSModulePath: 'C:\\Users\\p\\Documents\\WindowsPowerShell\\Modules', PATH: 'C:\\tools', TEMP: 'C:\\t' }, { RO_PID: '42', ComSpec: 'C:\\fake\\cmd.exe' }, windows)
    expect(env).toEqual({
      PATH: 'C:\\tools',
      TEMP: 'C:\\t',
      RO_PID: '42',
      SystemRoot: 'D:\\WIN',
      windir: 'D:\\WIN',
      ComSpec: 'D:\\WIN\\system32\\cmd.exe',
      PSModulePath: 'D:\\Programs\\WindowsPowerShell\\Modules;D:\\WIN\\system32\\WindowsPowerShell\\v1.0\\Modules',
    })
    expect(systemEnvironment(windows).PSModulePath).not.toMatch(/Documents/i)
  })

  it.runIf(process.platform === 'win32')('on this Windows: the real System32 and Program Files, whatever the environment says', () => {
    process.env.SystemRoot = 'C:\\Users\\p\\fake'
    process.env.ComSpec = 'C:\\Users\\p\\fake\\cmd.exe'
    expect(existsSync(join(systemDirectory(), 'kernel32.dll'))).toBe(true)
    expect(systemProgram('tasklist.exe').toLowerCase()).toBe(join(systemDirectory(), 'tasklist.exe').toLowerCase())
    expect(existsSync(systemProgram('cmd.exe'))).toBe(true)
    expect(existsSync(powershellExe())).toBe(true)
    expect(existsSync(programFilesDirectory())).toBe(true)
    expect(systemDirectory()).not.toMatch(/fake/)
    expect(typeof processElevated()).toBe('boolean')
  })

  it('reads nothing at import: Koffi is loaded on the first question', async () => {
    vi.resetModules()
    const load = vi.fn(() => null)
    const windows = createWindowsSystem(load)
    expect(load).not.toHaveBeenCalled()
    windows.elevated()
    windows.systemDirectory()
    expect(load).toHaveBeenCalledTimes(1)
  })
})
