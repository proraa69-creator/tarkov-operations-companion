// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ packaged: true, userData: '' }))
const spawn = vi.hoisted(() => vi.fn(() => ({ unref: vi.fn() })))
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('electron', () => ({ app: { get isPackaged() { return env.packaged }, getPath: () => env.userData } }))

// The installed app exists only on Windows; the tests run anywhere.
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const execPath = Object.getOwnPropertyDescriptor(process, 'execPath')!
Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
const root = mkdtempSync(join(tmpdir(), 'raidos-install-'))
const installDir = join(root, 'Programs', 'Raid OS')
const installed = join(installDir, 'Raid OS.exe')
const uninstaller = join(installDir, 'Uninstall Raid OS.exe')
const downloads = join(root, 'Downloads')
const portable = join(downloads, 'RaidOSClient.exe')
env.userData = join(root, 'Tarkov Operator')
mkdirSync(installDir, { recursive: true })
mkdirSync(downloads, { recursive: true })
mkdirSync(env.userData, { recursive: true })
Object.defineProperty(process, 'execPath', { ...execPath, value: installed })
afterAll(() => {
  Object.defineProperty(process, 'platform', platform)
  Object.defineProperty(process, 'execPath', execPath)
  delete process.env.PORTABLE_EXECUTABLE_FILE
  rmSync(root, { recursive: true, force: true })
})

const { installedExe, openSetupForPortable, removeMigratedPortable, runSetupWhenClosed, updatableExe } = await import('./appInstall')
const migration = join(env.userData, 'portable-migration.json')

beforeEach(() => {
  spawn.mockClear()
  env.packaged = true
  delete process.env.PORTABLE_EXECUTABLE_FILE
  writeFileSync(installed, 'MZ installed')
  writeFileSync(uninstaller, 'MZ uninstaller')
  writeFileSync(portable, 'MZ portable')
  writeFileSync(`${portable}.update`, 'MZ portable update')
  rmSync(migration, { force: true })
})

describe('the installed app (electron/appInstall.ts)', () => {
  it('is the exe with the installer\'s uninstaller next to it; the portable exe and a development run are not', () => {
    expect(installedExe()).toBe(installed)
    expect(updatableExe()).toBe(installed)
    process.env.PORTABLE_EXECUTABLE_FILE = portable
    expect(installedExe()).toBeNull()
    expect(updatableExe()).toBe(portable)
    delete process.env.PORTABLE_EXECUTABLE_FILE
    env.packaged = false
    expect(installedExe()).toBeNull()
    env.packaged = true
    rmSync(uninstaller)
    expect(installedExe()).toBeNull()
  })

  it('«Установить» in the portable exe: the installer opens with its window and the exe is remembered for removal', () => {
    process.env.PORTABLE_EXECUTABLE_FILE = portable
    const setup = join(env.userData, 'updates', 'RaidOSSetup.exe')
    openSetupForPortable(setup)
    expect(spawn).toHaveBeenCalledWith(setup, [], expect.objectContaining({ detached: true }))
    expect(JSON.parse(readFileSync(migration, 'utf8')).exe).toBe(portable)
    delete process.env.PORTABLE_EXECUTABLE_FILE
    expect(() => openSetupForPortable(setup)).toThrow()
  })

  it('its first start removes that portable exe and its downloaded update, and only them', () => {
    writeFileSync(migration, JSON.stringify({ exe: portable }))
    removeMigratedPortable()
    expect(existsSync(portable)).toBe(false)
    expect(existsSync(`${portable}.update`)).toBe(false)
    expect(existsSync(migration)).toBe(false)
    expect(existsSync(installed)).toBe(true)
    // Never the installed exe itself, never anything but an exe.
    const notes = join(downloads, 'notes.txt')
    writeFileSync(notes, 'mine')
    for (const exe of [installed, notes, downloads]) {
      writeFileSync(migration, JSON.stringify({ exe }))
      removeMigratedPortable()
      expect(existsSync(exe)).toBe(true)
      expect(existsSync(migration)).toBe(false)
    }
  })

  it('the portable exe itself never removes anything: the note waits for the installed copy', () => {
    process.env.PORTABLE_EXECUTABLE_FILE = portable
    writeFileSync(migration, JSON.stringify({ exe: portable }))
    removeMigratedPortable()
    expect(existsSync(portable)).toBe(true)
    expect(existsSync(migration)).toBe(true)
  })

  it('a release that needs the installer: once the app has quit, it runs silently into the same folder and starts the app', () => {
    const setup = join(env.userData, 'updates', 'RaidOSSetup.exe')
    const script = runSetupWhenClosed(setup, installed)
    try {
      const lines = readFileSync(script, 'utf8').split('\r\n')
      // NSIS: /S without a window, electron-builder's --updated and --force-run, /D= last and unquoted.
      expect(lines).toContain('"%RO_SETUP%" /S --updated --force-run /D=%RO_DIR%')
      expect(lines.indexOf('"%RO_SETUP%" /S --updated --force-run /D=%RO_DIR%')).toBeGreaterThan(lines.indexOf(':run'))
      const [, , options] = spawn.mock.calls.at(-1) as unknown as [string, string[], { env: Record<string, string> }]
      expect(options.env).toMatchObject({ RO_PID: String(process.pid), RO_SETUP: setup, RO_DIR: installDir })
    } finally {
      rmSync(script, { force: true })
      rmSync(script.replace(/\.cmd$/, '.vbs'), { force: true })
    }
  })
})
