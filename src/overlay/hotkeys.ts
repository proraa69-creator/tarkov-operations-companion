/** Keys the overlay hotkeys can be bound to, keyed by KeyboardEvent.code. */
export interface HotkeyDefinition {
  label: string
  /** Windows virtual-key code, used by the native polling fallback. */
  vk: number
  /** Property name on uiohook-napi's UiohookKey table. */
  hook: string
}

const table: Record<string, HotkeyDefinition> = {}

for (let index = 0; index < 26; index += 1) {
  const letter = String.fromCharCode(65 + index)
  table[`Key${letter}`] = { label: letter, vk: 0x41 + index, hook: letter }
}
for (let digit = 0; digit <= 9; digit += 1) {
  table[`Digit${digit}`] = { label: String(digit), vk: 0x30 + digit, hook: String(digit) }
}
for (let index = 1; index <= 12; index += 1) {
  table[`F${index}`] = { label: `F${index}`, vk: 0x6f + index, hook: `F${index}` }
}
Object.assign(table, {
  Semicolon: { label: ';', vk: 0xba, hook: 'Semicolon' },
  Quote: { label: "'", vk: 0xde, hook: 'Quote' },
  Comma: { label: ',', vk: 0xbc, hook: 'Comma' },
  Period: { label: '.', vk: 0xbe, hook: 'Period' },
  Slash: { label: '/', vk: 0xbf, hook: 'Slash' },
  Backquote: { label: '`', vk: 0xc0, hook: 'Backquote' },
  BracketLeft: { label: '[', vk: 0xdb, hook: 'BracketLeft' },
  BracketRight: { label: ']', vk: 0xdd, hook: 'BracketRight' },
  Tab: { label: 'Tab', vk: 0x09, hook: 'Tab' },
  Insert: { label: 'Insert', vk: 0x2d, hook: 'Insert' },
  Home: { label: 'Home', vk: 0x24, hook: 'Home' },
  End: { label: 'End', vk: 0x23, hook: 'End' },
  PageUp: { label: 'PageUp', vk: 0x21, hook: 'PageUp' },
  PageDown: { label: 'PageDown', vk: 0x22, hook: 'PageDown' },
})

export const HOTKEYS: Readonly<Record<string, HotkeyDefinition>> = table
export const DEFAULT_ITEM_KEY = 'Semicolon'
export const DEFAULT_MINIMAP_KEY = 'KeyM'

export function isKnownHotkey(code: unknown): code is string {
  return typeof code === 'string' && Object.hasOwn(HOTKEYS, code)
}

export function hotkeyLabel(code: string) {
  return HOTKEYS[code]?.label ?? code
}
