// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyScreenMode, BORDERLESS_VALUE, findScreenMode, withScreenMode } from './screenMode'
import { HOTKEYS, isKnownHotkey, mouseHotkey } from '../../src/overlay/hotkeys'

const GRAPHICS = JSON.stringify({ Resolution: { Width: 2560, Height: 1440 }, DisplaySettings: { Display: 0, FullScreenMode: 0 }, VSync: false }, null, 2)
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const file = (text: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'raidos-graphics-'))
  dirs.push(dir)
  const path = join(dir, 'Graphics.ini')
  writeFileSync(path, text)
  return path
}

describe('borderless mode in the game settings (owner, 10.10.2026)', () => {
  it('finds the screen mode field, also nested or spelled FullscreenMode', () => {
    expect(findScreenMode(JSON.parse(GRAPHICS))).toEqual(['DisplaySettings', 'FullScreenMode'])
    expect(findScreenMode({ FullscreenMode: 2 })).toEqual(['FullscreenMode'])
    expect(findScreenMode({ ScreenMode: 'x' })).toBeNull()
  })

  it('changes only that field and keeps the file\'s indentation', () => {
    const changed = withScreenMode(GRAPHICS, BORDERLESS_VALUE)!
    expect(changed.previous).toBe(0)
    expect(JSON.parse(changed.text)).toEqual({ ...JSON.parse(GRAPHICS), DisplaySettings: { Display: 0, FullScreenMode: 1 } })
    expect(changed.text).toContain('\n  "Resolution"')
    expect(withScreenMode('not json', 1)).toBeNull()
  })

  it('sets borderless with a backup, puts the player\'s mode back when switched off, waits while the game runs', async () => {
    const path = file(GRAPHICS)
    expect(await applyScreenMode({ file: path, on: true, previous: null, gameRunning: true })).toEqual({ result: 'game-running', previous: null })
    expect(readFileSync(path, 'utf8')).toBe(GRAPHICS)
    const on = await applyScreenMode({ file: path, on: true, previous: null, gameRunning: false })
    expect(on).toEqual({ result: 'applied', previous: 0 })
    expect(findValue(path)).toBe(1)
    expect(readFileSync(`${path}.raidos-backup`, 'utf8')).toBe(GRAPHICS)
    expect(await applyScreenMode({ file: path, on: true, previous: 0, gameRunning: false })).toEqual({ result: 'already', previous: 0 })
    expect(await applyScreenMode({ file: path, on: false, previous: 0, gameRunning: false })).toEqual({ result: 'restored', previous: null })
    expect(findValue(path)).toBe(0)
    // Off and never changed by the app: the file is not touched at all.
    expect(await applyScreenMode({ file: path, on: false, previous: null, gameRunning: false })).toEqual({ result: 'off', previous: null })
    expect(await applyScreenMode({ file: join(path, '..', 'missing.ini'), on: true, previous: null, gameRunning: false })).toEqual({ result: 'no-file', previous: null })
    expect(existsSync(`${path}.raidos-backup`)).toBe(true)
  })
})

describe('extra mouse buttons as hotkeys', () => {
  it('side buttons 4 / 5 and the wheel click, read by the native polling', () => {
    expect(mouseHotkey(3)).toBe('Mouse4')
    expect(mouseHotkey(4)).toBe('Mouse5')
    expect(mouseHotkey(1)).toBe('MouseMiddle')
    expect(mouseHotkey(0)).toBeNull()
    expect(mouseHotkey(2)).toBeNull()
    expect(isKnownHotkey('Mouse4')).toBe(true)
    expect([HOTKEYS.Mouse4.vk, HOTKEYS.Mouse5.vk, HOTKEYS.MouseMiddle.vk]).toEqual([0x05, 0x06, 0x04])
  })
})

function findValue(path: string) {
  return (JSON.parse(readFileSync(path, 'utf8')) as { DisplaySettings: { FullScreenMode: number } }).DisplaySettings.FullScreenMode
}
