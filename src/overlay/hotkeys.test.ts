import { describe, expect, it } from 'vitest'
import { comboMouseHotkey, HOTKEYS, hotkeyCode, hotkeyLabel, hotkeyPressed, isComboHotkey, isKnownHotkey, mouseHotkey, parseHotkey } from './hotkeys'

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

describe('one key or a combination (owner, 10.11.2026: «зажали Ctrl… нажимают ЛКМ»)', () => {
  it('reads and writes combinations, the left and right buttons only in one', () => {
    expect(parseHotkey('Ctrl+MouseLeft')).toEqual({ modifiers: ['Ctrl'], key: 'MouseLeft' })
    expect(isKnownHotkey('Shift+Alt+KeyF')).toBe(true)
    expect(isKnownHotkey('MouseLeft')).toBe(false)
    expect(isKnownHotkey('Alt+Shift+KeyF')).toBe(false)
    expect(isKnownHotkey('Ctrl+Ctrl+KeyF')).toBe(false)
    expect(isKnownHotkey('Win+KeyF')).toBe(false)
    expect(isKnownHotkey('Ctrl+')).toBe(false)
    expect(isComboHotkey('Ctrl+Semicolon')).toBe(true)
    expect(isComboHotkey('Semicolon')).toBe(false)
    expect(hotkeyCode(['Alt', 'Ctrl'], 'MouseRight')).toBe('Ctrl+Alt+MouseRight')
    expect(comboMouseHotkey(0)).toBe('MouseLeft')
    expect(comboMouseHotkey(2)).toBe('MouseRight')
    expect(hotkeyLabel('Ctrl+MouseLeft')).toBe('Ctrl + ЛКМ')
    expect(hotkeyLabel('Ctrl+MouseLeft', (text) => text === 'ЛКМ' ? 'LMB' : text)).toBe('Ctrl + LMB')
    expect(hotkeyLabel('Semicolon')).toBe(';')
  })

  it('a combination needs exactly its modifiers held; a single key none but Shift', () => {
    const state = (pressedKeys: number[], held: number[]) => [(vk: number) => pressedKeys.includes(vk), (vk: number) => held.includes(vk)] as const
    expect(hotkeyPressed('Ctrl+MouseLeft', ...state([0x01], [0x11]))).toBe(true)
    expect(hotkeyPressed('Ctrl+MouseLeft', ...state([0x01], []))).toBe(false)
    expect(hotkeyPressed('Ctrl+MouseLeft', ...state([0x01], [0x11, 0x12]))).toBe(false)
    expect(hotkeyPressed('Ctrl+MouseLeft', ...state([], [0x11]))).toBe(false)
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
