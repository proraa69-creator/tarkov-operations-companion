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

/** The modifiers a combination holds, in the order they are written; their Windows virtual-key codes. */
export const MODIFIERS = { Ctrl: 0x11, Shift: 0x10, Alt: 0x12 } as const
export type HotkeyModifier = keyof typeof MODIFIERS
const MODIFIER_ORDER: HotkeyModifier[] = ['Ctrl', 'Shift', 'Alt']

export interface ParsedHotkey {
  /** The held keys: none for a single key. */
  modifiers: HotkeyModifier[]
  /** The pressed key or button (a code of HOTKEYS). */
  key: string
}

/**
 * A hotkey setting: a single key («Semicolon», «Mouse4») or a combination — modifiers and one key or mouse button
 * joined by «+» («Ctrl+MouseLeft», «Shift+Alt+KeyF»). null when it is neither.
 */
export function parseHotkey(code: unknown): ParsedHotkey | null {
  if (typeof code !== 'string' || !code) return null
  const parts = code.split('+')
  const key = parts.pop()!
  if (!Object.hasOwn(HOTKEYS, key)) return null
  const modifiers = parts as HotkeyModifier[]
  if (!modifiers.length) return Object.hasOwn(COMBO_ONLY, key) ? null : { modifiers, key }
  if (new Set(modifiers).size !== modifiers.length || modifiers.some((part) => !Object.hasOwn(MODIFIERS, part))) return null
  // One way to write each combination: the modifiers in their order.
  const sorted = MODIFIER_ORDER.filter((part) => modifiers.includes(part))
  if (sorted.join('+') !== modifiers.join('+')) return null
  return { modifiers, key }
}

/** The setting for these modifiers and key («Ctrl+MouseLeft»; a single key without modifiers). */
export function hotkeyCode(modifiers: Iterable<HotkeyModifier>, key: string) {
  const held = new Set(modifiers)
  return [...MODIFIER_ORDER.filter((part) => held.has(part)), key].join('+')
}

export const isComboHotkey = (code: string) => Boolean(parseHotkey(code)?.modifiers.length)

export function isKnownHotkey(code: unknown): code is string {
  return parseHotkey(code) !== null
}

/** «Мышь 4», «Ctrl + ЛКМ»; `translate` turns the key's own label into the page's language. */
export function hotkeyLabel(code: string, translate: (text: string) => string = (text) => text) {
  const parsed = parseHotkey(code)
  if (!parsed) return translate(HOTKEYS[code]?.label ?? code)
  return [...parsed.modifiers, translate(HOTKEYS[parsed.key]!.label)].join(' + ')
}

/**
 * Whether the hotkey went down this poll. `pressed` reads (and clears) the key's «pressed since last time» bit, so it is
 * read every poll whatever the modifiers; `down` tells whether a key is held now. A single key counts only without
 * Ctrl and Alt held (they are the game's own combinations); a combination needs exactly its modifiers held.
 */
export function hotkeyPressed(code: string, pressed: (vk: number) => boolean, down: (vk: number) => boolean) {
  const parsed = parseHotkey(code)
  if (!parsed) return false
  const hit = pressed(HOTKEYS[parsed.key]!.vk)
  if (!hit) return false
  return MODIFIER_ORDER.every((part) => {
    const held = down(MODIFIERS[part])
    if (parsed.modifiers.includes(part)) return held
    // Shift alone with a single key was always allowed (a key pressed while running).
    return part === 'Shift' && !parsed.modifiers.length ? true : !held
  })
}
