import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

interface Link { appUserModelId?: string; target?: string }
const env = vi.hoisted(() => ({ packaged: true, appData: '', name: 'Raid OS', links: new Map<string, Link>(), ids: [] as string[] }))
vi.mock('electron', () => ({
  app: {
    get isPackaged() { return env.packaged },
    getName: () => env.name,
    getPath: () => env.appData,
    setAppUserModelId: (id: string) => { env.ids.push(id) },
  },
  shell: {
    readShortcutLink: (file: string) => {
      const link = env.links.get(file)
      if (!link) throw new Error('Failed to read shortcut link')
      return { target: '', ...link }
    },
  },
}))

import { APP_USER_MODEL_ID, removeStaleStartMenuShortcut, applyInstallerIdentity } from './startMenuIdentity'

// The Start menu shortcuts exist only on Windows; the tests run anywhere.
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
const root = mkdtempSync(join(tmpdir(), 'raidos-start-menu-'))
const programs = join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
const lnk = join(programs, 'Raid OS.lnk')
const exe = join(root, 'RaidOS', 'Raid OS.exe')
const shortcut = (link: Link) => { writeFileSync(lnk, 'lnk'); env.links.set(lnk, link) }

afterAll(() => { Object.defineProperty(process, 'platform', platform); rmSync(root, { recursive: true, force: true }) })
beforeEach(() => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  Object.assign(env, { packaged: true, appData: root, name: 'Raid OS' })
  env.links.clear()
  env.ids.length = 0
  rmSync(programs, { recursive: true, force: true })
  mkdirSync(programs, { recursive: true })
  mkdirSync(join(root, 'RaidOS'), { recursive: true })
  writeFileSync(exe, 'exe')
})

// Report 252 (27.11.2026): «После обновления в пуске появился еще один ярлык, оба запускают одну и ту же копию приложения».
describe('one «Raid OS» in the Start menu', () => {
  it('the real app takes the installer AppUserModelID, the one of package.json build.appId', () => {
    const appId = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { build: { appId: string } }).build.appId
    expect(APP_USER_MODEL_ID).toBe(appId)
    expect(applyInstallerIdentity(true)).toBe(true)
    expect(env.ids).toEqual([APP_USER_MODEL_ID])
  })

  it('test and trial builds and a run from the sources keep their own ID, and so does any other system', () => {
    expect(applyInstallerIdentity(false)).toBe(false)
    env.packaged = false
    expect(applyInstallerIdentity(true)).toBe(false)
    env.packaged = true
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
    expect(applyInstallerIdentity(true)).toBe(false)
    expect(env.ids).toEqual([])
  })

  it('removes the shortcut Electron wrote under its old ID, its exe there or not', () => {
    shortcut({ appUserModelId: 'electron.app.Raid OS', target: exe })
    expect(removeStaleStartMenuShortcut()).toBe(true)
    expect(existsSync(lnk)).toBe(false)
  })

  it('removes our shortcut whose exe is gone (a closed portable copy) and keeps one whose exe is there', () => {
    shortcut({ appUserModelId: APP_USER_MODEL_ID, target: join(root, 'nsA1B2.tmp', 'app', 'Raid OS.exe') })
    expect(removeStaleStartMenuShortcut()).toBe(true)
    expect(existsSync(lnk)).toBe(false)
    shortcut({ appUserModelId: APP_USER_MODEL_ID, target: exe })
    expect(removeStaleStartMenuShortcut()).toBe(false)
    expect(existsSync(lnk)).toBe(true)
  })

  it('keeps the player own shortcut (no ID of ours), a file Windows cannot read, and another app of the same name', () => {
    shortcut({ target: join(root, 'gone', 'Raid OS.exe') })
    expect(removeStaleStartMenuShortcut()).toBe(false)
    expect(existsSync(lnk)).toBe(true)
    shortcut({ appUserModelId: 'electron.app.Raid OS Test', target: exe })
    expect(removeStaleStartMenuShortcut()).toBe(false)
    env.links.clear()
    expect(removeStaleStartMenuShortcut()).toBe(false)
    expect(existsSync(lnk)).toBe(true)
  })

  it('looks only at the shortcut of this app name, and does nothing without one or outside Windows', () => {
    expect(removeStaleStartMenuShortcut()).toBe(false)
    shortcut({ appUserModelId: 'electron.app.Raid OS', target: exe })
    env.name = 'Raid OS Test'
    expect(removeStaleStartMenuShortcut()).toBe(false)
    env.name = 'Raid OS'
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
    expect(removeStaleStartMenuShortcut()).toBe(false)
    expect(existsSync(lnk)).toBe(true)
  })
})
