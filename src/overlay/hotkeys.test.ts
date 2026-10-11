import { describe, expect, it } from 'vitest'
import { HOTKEYS, isKnownHotkey, mouseHotkey } from './hotkeys'

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
