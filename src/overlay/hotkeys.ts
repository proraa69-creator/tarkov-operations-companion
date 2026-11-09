/** Keys the app's hotkeys (item info, Collector scan) can be bound to, keyed by KeyboardEvent.code. */
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
  // Extra mouse buttons (owner, 10.10.2026: «кнопки наших функций на доп. кнопки мышки»): caught by the native key
  // polling (GetAsyncKeyState reads mouse buttons too), not by the keyboard hook — hence no `hook` name.
  Mouse4: { label: 'Мышь 4', vk: 0x05, hook: '' },
  Mouse5: { label: 'Мышь 5', vk: 0x06, hook: '' },
  MouseMiddle: { label: 'Колесо мыши', vk: 0x04, hook: '' },
})

/**
 * The left and right mouse buttons: only in a combination («Ctrl + ЛКМ», owner 10.11.2026) — alone they are the game's
 * own clicks.
 */
const COMBO_ONLY: Record<string, HotkeyDefinition> = {
  MouseLeft: { label: 'ЛКМ', vk: 0x01, hook: '' },
  MouseRight: { label: 'ПКМ', vk: 0x02, hook: '' },
}

/** A mouse button of a mousedown event as a hotkey code (only the middle and the two side buttons), or null. */
export function mouseHotkey(button: number): string | null {
  return button === 1 ? 'MouseMiddle' : button === 3 ? 'Mouse4' : button === 4 ? 'Mouse5' : null
}

/** Any mouse button of a mousedown event as the second part of a combination (left and right too), or null. */
export function comboMouseHotkey(button: number): string | null {
  return button === 0 ? 'MouseLeft' : button === 2 ? 'MouseRight' : mouseHotkey(button)
}

export const HOTKEYS: Readonly<Record<string, HotkeyDefinition>> = { ...table, ...COMBO_ONLY }
export const DEFAULT_ITEM_KEY = 'Semicolon'

/** Ctrl, Shift and Alt as the held key of a combination; their Windows virtual-key codes. */
export const MODIFIERS = { Ctrl: 0x11, Shift: 0x10, Alt: 0x12 } as const
export type HotkeyModifier = keyof typeof MODIFIERS
const isModifier = (part: string): part is HotkeyModifier => Object.hasOwn(MODIFIERS, part)

/** A KeyboardEvent.code of Ctrl, Shift or Alt (left or right) as the modifier, or null. */
export function modifierOfCode(code: string): HotkeyModifier | null {
  const match = /^(Control|Shift|Alt)(Left|Right)$/.exec(code)
  return match ? (match[1] === 'Control' ? 'Ctrl' : match[1] as HotkeyModifier) : null
}

export interface ParsedHotkey {
  /** The key held down first (Ctrl, Shift, Alt or any key / mouse button but the left one); null for a single key. */
  hold: string | null
  /** The key or button pressed (a code of HOTKEYS). */
  key: string
}

/** Whether a code can be the held key of a combination (the left mouse button cannot: it is how the page is used). */
export function isHoldKey(code: string) {
  return isModifier(code) || (Object.hasOwn(HOTKEYS, code) && code !== 'MouseLeft')
}

/**
 * A hotkey setting: a single key («Semicolon», «Mouse4») or a combination of two the player binds one after the other —
 * the first held, the second pressed («Ctrl+MouseLeft», «Mouse4+KeyF»; owner, 10.11.2026: «первая удерживается, вторая
 * кликается»). null when it is neither.
 */
export function parseHotkey(code: unknown): ParsedHotkey | null {
  if (typeof code !== 'string' || !code) return null
  const parts = code.split('+')
  if (parts.length > 2) return null
  const key = parts.pop()!
  if (!Object.hasOwn(HOTKEYS, key)) return null
  const hold = parts[0] ?? null
  if (hold === null) return Object.hasOwn(COMBO_ONLY, key) ? null : { hold, key }
  if (hold === key || !isHoldKey(hold)) return null
  return { hold, key }
}

/** The setting for a held key and a pressed one (a single key when nothing is held). */
export function hotkeyCode(hold: string | null, key: string) {
  return hold ? `${hold}+${key}` : key
}

export const isComboHotkey = (code: string) => Boolean(parseHotkey(code)?.hold)

export function isKnownHotkey(code: unknown): code is string {
  return parseHotkey(code) !== null
}

/** The label of one key («Ctrl», «Мышь 4», «ЛКМ»). */
export function keyLabel(code: string, translate: (text: string) => string = (text) => text) {
  return isModifier(code) ? code : translate(HOTKEYS[code]?.label ?? code)
}

/** «Мышь 4», «Ctrl + ЛКМ»; `translate` turns a key's own label into the page's language. */
export function hotkeyLabel(code: string, translate: (text: string) => string = (text) => text) {
  const parsed = parseHotkey(code)
  if (!parsed) return keyLabel(code, translate)
  return parsed.hold ? `${keyLabel(parsed.hold, translate)} + ${keyLabel(parsed.key, translate)}` : keyLabel(parsed.key, translate)
}

/**
 * Whether the hotkey went down this poll. `pressed` reads (and clears) the key's «pressed since last time» bit, so it is
 * read every poll whatever is held; `down` tells whether a key is held now. A single key counts only without Ctrl and
 * Alt held (they are the game's own combinations); a combination when its first key is held.
 */
export function hotkeyPressed(code: string, pressed: (vk: number) => boolean, down: (vk: number) => boolean) {
  const parsed = parseHotkey(code)
  if (!parsed) return false
  const hit = pressed(HOTKEYS[parsed.key]!.vk)
  if (!hit) return false
  if (!parsed.hold) return !down(MODIFIERS.Ctrl) && !down(MODIFIERS.Alt)
  return down(isModifier(parsed.hold) ? MODIFIERS[parsed.hold] : HOTKEYS[parsed.hold]!.vk)
}
