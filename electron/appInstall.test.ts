// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ packaged: true, userData: '', home: '' }))
const spawn = vi.hoisted(() => vi.fn(() => ({ unref: vi.fn() })))
vi.mock('node:child_process', () => ({ spawn }))
// Windows refuses to open a running exe for writing; the exes in these folders stand for running copies.
const running = vi.hoisted(() => new Set<string>())
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    open: async (file: string, flags: string) => {
      if (flags !== 'r' && [...running].some((name) => file.includes(name))) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      return fs.open(file, flags)
    },
  }
})
const openPath = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>(async () => ''))
vi.mock('electron', () => ({ app: { get isPackaged() { return env.packaged }, getPath: (name: string) => (name === 'home' ? env.home : env.userData) }, shell: { openPath } }))

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
env.home = root
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

const { installedExe, openSetupForPortable, removeMigratedPortable, removePortableLeftovers, runSetupWhenClosed, updatableExe } = await import('./appInstall')
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

  it('«Установить» in the portable exe: Windows opens the installer (asking for the rights if need be) and the exe is remembered for removal', async () => {
    process.env.PORTABLE_EXECUTABLE_FILE = portable
    const setup = join(env.userData, 'updates', 'RaidOSSetup.exe')
    openPath.mockClear()
    await openSetupForPortable(setup)
    expect(openPath).toHaveBeenCalledWith(setup)
    expect(JSON.parse(readFileSync(migration, 'utf8')).exe).toBe(portable)
    // The player said «Нет» to Windows: no note is left behind, the error comes back to the window.
    openPath.mockResolvedValueOnce('The operation was canceled by the user.')
    await expect(openSetupForPortable(setup)).rejects.toThrow(/canceled/)
    expect(existsSync(migration)).toBe(false)
    delete process.env.PORTABLE_EXECUTABLE_FILE
    await expect(openSetupForPortable(setup)).rejects.toThrow()
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

  // Security review, 03.11.2026: the note lies in %APPDATA% and the app removes as administrator.
  it('a planted note never removes an exe outside the player\'s own folder', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'raidos-system-'))
    try {
      const systemExe = join(elsewhere, 'MsMpEng.exe')
      writeFileSync(systemExe, 'MZ')
      writeFileSync(migration, JSON.stringify({ exe: systemExe }))
      removeMigratedPortable()
      expect(existsSync(systemExe)).toBe(true)
      expect(existsSync(migration)).toBe(false)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
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

describe('the folders the portable exe left in %TEMP% (electron/appInstall.ts)', () => {
  const temp = join(root, 'Temp')
  const hoursAgo = (hours: number) => Date.now() / 1000 - hours * 3600
  function unpacked(name: string, exe = 'Raid OS.exe', at = hoursAgo(2)) {
    const folder = join(temp, name)
    mkdirSync(join(folder, 'app', 'resources'), { recursive: true })
    writeFileSync(join(folder, 'app', exe), 'MZ')
    writeFileSync(join(folder, 'app', 'resources', 'app.asar'), 'asar')
    utimesSync(folder, at, at)
    return folder
  }

  beforeEach(() => {
    rmSync(temp, { recursive: true, force: true })
    mkdirSync(temp, { recursive: true })
    running.clear()
  })

  it('go when nothing runs from them; this copy\'s own, a fresh one, a running one and other programs\' stay', async () => {
    const left = unpacked('nsi439F.tmp')
    const ownerEdition = unpacked('nsxEACE.tmp', 'Raid OS Owner.exe')
    const halfRemoved = join(temp, 'nsr20F0.tmp.raidos-old')
    mkdirSync(join(halfRemoved, 'app'), { recursive: true })
    const own = unpacked('nsyED9F.tmp')
    const fresh = unpacked('nsyB63F.tmp', 'Raid OS.exe', hoursAgo(0.2))
    const busy = unpacked('nsa1234.tmp')
    running.add('nsa1234.tmp')
    const stranger = unpacked('nsb5678.tmp', 'Other.exe')
    const chrome = join(temp, 'chrome_BITS_6680_1334294774')
    mkdirSync(chrome)
    process.env.PORTABLE_EXECUTABLE_FILE = portable
    Object.defineProperty(process, 'execPath', { ...execPath, value: join(own, 'app', 'Raid OS.exe') })
    try {
      await removePortableLeftovers(async () => false, temp)
    } finally {
      Object.defineProperty(process, 'execPath', { ...execPath, value: installed })
    }
    expect([left, ownerEdition, halfRemoved].map(existsSync)).toEqual([false, false, false])
    expect([own, fresh, busy, stranger, chrome].map(existsSync)).toEqual([true, true, true, true, true])
    expect(existsSync(`${busy}.raidos-old`)).toBe(false)
  })

  it('wait while the game runs, and are looked for only by the packaged app', async () => {
    const left = unpacked('nsi439F.tmp')
    await removePortableLeftovers(async () => true, temp)
    expect(existsSync(left)).toBe(true)
    env.packaged = false
    await removePortableLeftovers(async () => false, temp)
    expect(existsSync(left)).toBe(true)
    env.packaged = true
    await removePortableLeftovers(async () => false, temp)
    expect(existsSync(left)).toBe(false)
  })
})
