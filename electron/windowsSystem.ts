import { createRequire } from 'node:module'
import { win32 } from 'node:path'

/**
 * Windows' own folders and this process's rights, as Windows itself gives them, never as the environment says (security
 * review, 27.11.2026). The app runs with administrator rights, so which program it starts must not depend on PATH, the
 * current folder or %SystemRoot%, %windir%, %ComSpec%, %ProgramFiles% and %PSModulePath%, which it does not control. So:
 *  - System32 comes from GetSystemDirectoryW (kernel32), Program Files from SHGetFolderPathW (shell32), through Koffi,
 *    each read once; every program the app starts is named by its full path from here;
 *  - the rights come from this process's token (IsUserAnAdmin, shell32): experimental/win32.ts isElevated() asks here;
 *  - a child process gets these values in its environment (childEnvironment), so a script it runs finds the same folders.
 * Without Koffi (the tests, another system, a copy whose native module is gone) the usual places on drive C: and rights
 * unknown (null). Only Node built-ins and Koffi: electron/boot.ts loads this before the build that runs.
 */

/** The functions of Koffi used here (koffi.load(...).func(...)). */
export interface KoffiLibraries {
  load(name: string): { func(signature: string): (...args: unknown[]) => unknown }
}

/** Where Windows usually is, for a copy that cannot ask it. */
export const FALLBACK_SYSTEM_DIRECTORY = 'C:\\Windows\\System32'

const MAX_PATH = 260
/** CSIDL_PROGRAM_FILES: «C:\Program Files» of a 64-bit process. */
const CSIDL_PROGRAM_FILES = 0x26
/** A folder on a drive (C:\…): nothing relative, no network share, no device path. */
const DRIVE_FOLDER = /^[A-Za-z]:\\[^<>"|?*\0]*$/

/** The environment variables childEnvironment() always sets itself. */
export const SYSTEM_VARIABLES = ['SystemRoot', 'windir', 'ComSpec', 'PSModulePath'] as const

export interface WindowsSystem {
  /** «C:\Windows\System32». */
  systemDirectory(): string
  /** «C:\Windows». */
  windowsDirectory(): string
  /** «C:\Program Files». */
  programFilesDirectory(): string
  /** Whether this process runs with administrator rights (its token); null when it cannot be told. */
  elevated(): boolean | null
}

const wide = (buffer: Uint16Array, length = buffer.indexOf(0)) => String.fromCharCode(...buffer.subarray(0, length < 0 ? buffer.length : length))
const folder = (value: string | null | undefined) => (value && DRIVE_FOLDER.test(value) ? value.replace(/\\+$/, '') : null)

/**
 * The answers of one Windows (`load` gives Koffi, or null without it). Each one is read once; a call that fails falls back
 * as described above.
 */
export function createWindowsSystem(load: () => KoffiLibraries | null): WindowsSystem {
  let koffi: KoffiLibraries | null | undefined
  const libraries = () => {
    if (koffi === undefined) {
      try { koffi = load() } catch { koffi = null }
    }
    return koffi
  }
  const ask = <T>(read: (koffi: KoffiLibraries) => T): T | null => {
    const found = libraries()
    if (!found) return null
    try { return read(found) } catch { return null }
  }
  let system: string | undefined
  let programFiles: string | undefined
  let rights: boolean | null | undefined
  const systemDirectory = () => {
    system ??= folder(ask((found) => {
      const read = found.load('kernel32.dll').func('uint32 __stdcall GetSystemDirectoryW(_Out_ uint16_t* lpBuffer, uint32 uSize)')
      const buffer = new Uint16Array(MAX_PATH + 1)
      const length = Number(read(buffer, buffer.length))
      return length > 0 && length < buffer.length ? wide(buffer, length) : null
    })) ?? FALLBACK_SYSTEM_DIRECTORY
    return system
  }
  const windowsDirectory = () => win32.dirname(systemDirectory())
  return {
    systemDirectory,
    windowsDirectory,
    programFilesDirectory() {
      programFiles ??= folder(ask((found) => {
        const read = found.load('shell32.dll').func('long __stdcall SHGetFolderPathW(void* hwnd, int csidl, void* hToken, uint32 dwFlags, _Out_ uint16_t* pszPath)')
        const buffer = new Uint16Array(MAX_PATH)
        return Number(read(null, CSIDL_PROGRAM_FILES, null, 0, buffer)) === 0 ? wide(buffer) : null
      })) ?? win32.join(`${windowsDirectory().slice(0, 2)}\\`, 'Program Files')
      return programFiles
    },
    elevated() {
      if (rights === undefined) {
        const answer = ask((found) => Number(found.load('shell32.dll').func('int __stdcall IsUserAnAdmin()')()))
        rights = answer === null || !Number.isFinite(answer) ? null : answer !== 0
      }
      return rights
    },
  }
}

const require = createRequire(import.meta.url)
const thisWindows = createWindowsSystem(() => (process.platform === 'win32' ? require('koffi') as KoffiLibraries : null))

export const systemDirectory = () => thisWindows.systemDirectory()
export const windowsDirectory = () => thisWindows.windowsDirectory()
export const programFilesDirectory = () => thisWindows.programFilesDirectory()
/** Whether this process runs with administrator rights, by its token; null when it cannot be told. */
export const processElevated = () => thisWindows.elevated()

/** A program of System32 by its full path: systemProgram('tasklist.exe'), systemProgram('WindowsPowerShell', 'v1.0', 'powershell.exe'). */
export const systemProgram = (...parts: string[]) => win32.join(thisWindows.systemDirectory(), ...parts)
/** Windows PowerShell 5.1. */
export const powershellExe = () => systemProgram('WindowsPowerShell', 'v1.0', 'powershell.exe')

/**
 * The system variables a child process gets, from the folders above: %SystemRoot% and %windir%, %ComSpec% (cmd.exe) and a
 * PSModulePath of the two folders only administrators may write (Program Files and System32), as Windows itself has it.
 */
export function systemEnvironment(system: WindowsSystem = thisWindows): Record<(typeof SYSTEM_VARIABLES)[number], string> {
  const windows = system.windowsDirectory()
  return {
    SystemRoot: windows,
    windir: windows,
    ComSpec: win32.join(system.systemDirectory(), 'cmd.exe'),
    PSModulePath: [win32.join(system.programFilesDirectory(), 'WindowsPowerShell', 'Modules'), win32.join(system.systemDirectory(), 'WindowsPowerShell', 'v1.0', 'Modules')].join(';'),
  }
}

/**
 * `base` (process.env by default) with `extra` for a child process. The system variables of both, in whatever case they
 * are written (Windows treats SYSTEMROOT and SystemRoot as one), give way to systemEnvironment().
 */
export function childEnvironment(base: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}, system: WindowsSystem = thisWindows): Record<string, string> {
  const own = new Set(SYSTEM_VARIABLES.map((name) => name.toLowerCase()))
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries({ ...base, ...extra })) if (typeof value === 'string' && !own.has(name.toLowerCase())) env[name] = value
  return { ...env, ...systemEnvironment(system) }
}
