import { describe, expect, it } from 'vitest'
import { acceleratorOf } from './hotkey'

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, ...mods })

describe('the key that turns the preset on and off', () => {
  it('is an accelerator the main process registers', () => {
    expect(acceleratorOf(key('F8'))).toBe('F8')
    expect(acceleratorOf(key('KeyL', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+L')
    expect(acceleratorOf(key('Numpad5', { altKey: true }))).toBe('Alt+num5')
    expect(acceleratorOf(key('Digit3'))).toBe('3')
  })

  it('is nothing for a modifier alone, Esc, Tab or Enter', () => {
    for (const code of ['ShiftLeft', 'ControlLeft', 'Escape', 'Tab', 'Enter']) expect(acceleratorOf(key(code))).toBe('')
  })
})
