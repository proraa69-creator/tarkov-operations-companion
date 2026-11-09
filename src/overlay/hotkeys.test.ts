import { describe, expect, it } from 'vitest'
import { comboMouseHotkey, HOTKEYS, hotkeyCode, hotkeyLabel, hotkeyPressed, isComboHotkey, isHoldKey, isKnownHotkey, modifierOfCode, mouseHotkey, parseHotkey } from './hotkeys'

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

describe('one key or a combination (owner, 10.11.2026: «первая удерживается, вторая кликается»)', () => {
  it('reads and writes combinations of a held key and a pressed one', () => {
    expect(parseHotkey('Ctrl+MouseLeft')).toEqual({ hold: 'Ctrl', key: 'MouseLeft' })
    expect(parseHotkey('Mouse4+KeyF')).toEqual({ hold: 'Mouse4', key: 'KeyF' })
    expect(parseHotkey('Semicolon')).toEqual({ hold: null, key: 'Semicolon' })
    expect(isKnownHotkey('KeyQ+MouseRight')).toBe(true)
    expect(isKnownHotkey('MouseLeft')).toBe(false)
    expect(isKnownHotkey('MouseLeft+KeyF')).toBe(false)
    expect(isKnownHotkey('KeyF+KeyF')).toBe(false)
    expect(isKnownHotkey('Ctrl+Alt+KeyF')).toBe(false)
    expect(isKnownHotkey('Win+KeyF')).toBe(false)
    expect(isKnownHotkey('Ctrl+')).toBe(false)
    expect(isComboHotkey('Ctrl+Semicolon')).toBe(true)
    expect(isComboHotkey('Semicolon')).toBe(false)
    expect(hotkeyCode('Alt', 'MouseRight')).toBe('Alt+MouseRight')
    expect(hotkeyCode(null, 'KeyF')).toBe('KeyF')
    expect(modifierOfCode('ControlRight')).toBe('Ctrl')
    expect(modifierOfCode('ShiftLeft')).toBe('Shift')
    expect(modifierOfCode('KeyA')).toBeNull()
    expect(isHoldKey('MouseRight')).toBe(true)
    expect(isHoldKey('MouseLeft')).toBe(false)
    expect(comboMouseHotkey(0)).toBe('MouseLeft')
    expect(comboMouseHotkey(2)).toBe('MouseRight')
    expect(hotkeyLabel('Ctrl+MouseLeft')).toBe('Ctrl + ЛКМ')
    expect(hotkeyLabel('Mouse4+MouseLeft', (text) => ({ ЛКМ: 'LMB', 'Мышь 4': 'Mouse 4' })[text] ?? text)).toBe('Mouse 4 + LMB')
    expect(hotkeyLabel('Semicolon')).toBe(';')
  })

  it('a combination needs its first key held; a single key no Ctrl or Alt', () => {
    const state = (pressedKeys: number[], held: number[]) => [(vk: number) => pressedKeys.includes(vk), (vk: number) => held.includes(vk)] as const
    expect(hotkeyPressed('Ctrl+MouseLeft', ...state([0x01], [0x11]))).toBe(true)
    expect(hotkeyPressed('Ctrl+MouseLeft', ...state([0x01], []))).toBe(false)
    expect(hotkeyPressed('Ctrl+MouseLeft', ...state([], [0x11]))).toBe(false)
    expect(hotkeyPressed('Mouse4+KeyF', ...state([0x46], [0x05]))).toBe(true)
    expect(hotkeyPressed('KeyQ+MouseLeft', ...state([0x01], [0x51]))).toBe(true)
    expect(hotkeyPressed('KeyQ+MouseLeft', ...state([0x01], [0x11]))).toBe(false)
    expect(hotkeyPressed('Semicolon', ...state([0xba], []))).toBe(true)
    expect(hotkeyPressed('Semicolon', ...state([0xba], [0x10]))).toBe(true)
    expect(hotkeyPressed('Semicolon', ...state([0xba], [0x11]))).toBe(false)
    expect(hotkeyPressed('', ...state([0xba], []))).toBe(false)
  })

  it('reads the pressed bit of the key every poll, whatever is held', () => {
    const read: number[] = []
    hotkeyPressed('Ctrl+MouseLeft', (vk) => { read.push(vk); return true }, () => false)
    expect(read).toEqual([0x01])
  })
})
