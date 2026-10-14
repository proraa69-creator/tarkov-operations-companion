/**
 * The game's own screenshot key. EFT logs its control settings (JSON) to application.log when it starts:
 *   …{"keyName":"MakeScreenshot","variants":[{"keyCode":["F12"]},{"keyCode":[]}],"pressType":"Press"}…
 * Key names are Unity KeyCode names. A variant lists the keys pressed together (a combination such as
 * ["LeftAlt","F12"]); the first non-empty variant is the one the player set.
 */
const BINDING = /"keyName"\s*:\s*"MakeScreenshot"\s*,\s*"variants"\s*:\s*\[((?:\s*\{[^{}]*\}\s*,?)*)\s*\]/g
const VARIANT_KEYS = /"keyCode"\s*:\s*\[([^\]]*)\]/g

/** Keys of the screenshot binding in the newest settings the text logs; [] = not bound; null = not logged. */
export function parseScreenshotBinding(text: string): string[] | null {
  let variants: string | undefined
  for (const match of text.matchAll(BINDING)) variants = match[1]
  if (variants === undefined) return null
  for (const match of variants.matchAll(VARIANT_KEYS)) {
    const keys = (match[1] ?? '').split(',').map((key) => key.trim().replace(/^"|"$/g, '')).filter(Boolean)
    if (keys.length) return keys
  }
  return []
}

const NAMED: Record<string, number> = {
  Backspace: 0x08, Tab: 0x09, Clear: 0x0c, Return: 0x0d, Pause: 0x13, Break: 0x13, Escape: 0x1b, Space: 0x20,
  PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24, LeftArrow: 0x25, UpArrow: 0x26, RightArrow: 0x27, DownArrow: 0x28,
  Print: 0x2c, SysReq: 0x2c, Insert: 0x2d, Delete: 0x2e, Help: 0x2f,
  LeftWindows: 0x5b, LeftCommand: 0x5b, LeftMeta: 0x5b, RightWindows: 0x5c, RightCommand: 0x5c, RightMeta: 0x5c, Menu: 0x5d,
  KeypadMultiply: 0x6a, KeypadPlus: 0x6b, KeypadMinus: 0x6d, KeypadPeriod: 0x6e, KeypadDivide: 0x6f, KeypadEnter: 0x0d,
  Numlock: 0x90, CapsLock: 0x14, ScrollLock: 0x91,
  LeftShift: 0xa0, RightShift: 0xa1, LeftControl: 0xa2, RightControl: 0xa3, LeftAlt: 0xa4, RightAlt: 0xa5, AltGr: 0xa5,
  Semicolon: 0xba, Equals: 0xbb, Comma: 0xbc, Minus: 0xbd, Period: 0xbe, Slash: 0xbf, BackQuote: 0xc0,
  LeftBracket: 0xdb, Backslash: 0xdc, RightBracket: 0xdd, Quote: 0xde,
}

/** Keys sent with the E0 prefix (the navigation block, right-hand modifiers, numpad / and Enter, PrtSc). */
const EXTENDED = new Set(['PageUp', 'PageDown', 'End', 'Home', 'LeftArrow', 'UpArrow', 'RightArrow', 'DownArrow', 'Print', 'SysReq', 'Insert', 'Delete',
  'LeftWindows', 'LeftCommand', 'LeftMeta', 'RightWindows', 'RightCommand', 'RightMeta', 'Menu', 'KeypadDivide', 'KeypadEnter', 'RightControl', 'RightAlt', 'AltGr', 'Numlock'])

export interface GameKey { vk: number; extended: boolean }

/** Windows virtual-key code of a Unity KeyCode name; null for mouse/joystick buttons and unknown names. */
export function unityKey(name: string): GameKey | null {
  let vk: number | undefined = NAMED[name]
  if (vk === undefined && /^[A-Z]$/.test(name)) vk = name.charCodeAt(0)
  if (vk === undefined) {
    const digit = /^(Alpha|Keypad)([0-9])$/.exec(name)
    if (digit) vk = (digit[1] === 'Alpha' ? 0x30 : 0x60) + Number(digit[2])
  }
  if (vk === undefined) {
    const fn = /^F([1-9]|1[0-5])$/.exec(name)
    if (fn) vk = 0x6f + Number(fn[1])
  }
  return vk === undefined ? null : { vk, extended: EXTENDED.has(name) }
}

const LABELS: Record<string, string> = {
  Print: 'PrtSc', SysReq: 'PrtSc', LeftAlt: 'Left Alt', RightAlt: 'Right Alt', AltGr: 'AltGr', LeftControl: 'Left Ctrl', RightControl: 'Right Ctrl',
  LeftShift: 'Left Shift', RightShift: 'Right Shift', PageUp: 'Page Up', PageDown: 'Page Down', BackQuote: '`', Return: 'Enter', KeypadEnter: 'Num Enter',
  ScrollLock: 'Scroll Lock', CapsLock: 'Caps Lock', Numlock: 'Num Lock', LeftArrow: '←', RightArrow: '→', UpArrow: '↑', DownArrow: '↓',
}

/** «F12», «Left Alt + F12», «PrtSc», «Num 5». */
export function gameKeyLabel(keys: string[]) {
  return keys.map((key) => LABELS[key] ?? key.replace(/^Alpha(\d)$/, '$1').replace(/^Keypad(\d)$/, 'Num $1')).join(' + ')
}

export function isPrintScreen(keys: string[]) {
  return keys.length > 0 && (keys.at(-1) === 'Print' || keys.at(-1) === 'SysReq')
}

/** Unity's extra mouse buttons as Windows virtual keys: the wheel button, X1 (back) and X2 (forward). */
const MOUSE_VK: Record<string, number> = { Mouse2: 0x04, Mouse3: 0x05, Mouse4: 0x06 }

/** Windows virtual key of a Unity KeyCode name, the extra mouse buttons included; null for anything else. */
export function gameKeyVk(name: string): number | null {
  return unityKey(name)?.vk ?? MOUSE_VK[name] ?? null
}

/**
 * Whether the game's screenshot is bound to exactly this key (owner, 14.10.2026: «сделай что бы человек билдил кнопку в
 * игре одну и туже куда он билдит миникарту в приложении»): then the press that opens the minimap also makes the game
 * write the screenshot the position comes from — the app itself presses nothing. A combination (Alt + F12) never is.
 */
export function screenshotOnKey(keys: string[], vk: number | undefined) {
  return vk !== undefined && keys.length === 1 && gameKeyVk(keys[0]!) === vk
}

const LOGGED_AT = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?/g

/**
 * The newest screenshot binding a log text holds and when the game logged it: the time of the nearest log line before it
 * (local time, ms; 0 when there is none in reach). The game logs its keys when it starts, so a key changed later is only
 * in its Control.ini — the caller compares the two times.
 */
export function parseScreenshotBindingAt(text: string): { keys: string[]; at: number } | null {
  let last: RegExpMatchArray | undefined
  for (const match of text.matchAll(BINDING)) last = match
  if (!last) return null
  const keys = parseScreenshotBinding(last[0]) ?? []
  const index = last.index ?? 0
  let stamp: RegExpMatchArray | undefined
  for (const match of text.slice(Math.max(0, index - 65_536), index).matchAll(LOGGED_AT)) stamp = match
  const at = stamp ? Date.parse(`${stamp[1]}T${stamp[2]}`) : 0
  return { keys, at: Number.isFinite(at) ? at : 0 }
}
