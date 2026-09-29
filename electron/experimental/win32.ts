import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type Koffi = {
  load: (name: string) => { func: (signature: string) => (...args: unknown[]) => unknown }
  struct: (name: string, fields: Record<string, string>) => unknown
}

let api: {
  notificationState: (out: Int32Array) => number
  foreground: () => unknown
  windowText: (hwnd: unknown, buffer: Uint16Array, size: number) => number
  keyState: (key: number) => number
  sendInput: (count: number, input: Record<string, number>, size: number) => number
} | null | undefined

function win32() {
  if (api !== undefined) return api
  try {
    if (process.platform !== 'win32') throw new Error('not windows')
    const koffi = require('koffi') as Koffi
    const user32 = koffi.load('user32.dll')
    const shell32 = koffi.load('shell32.dll')
    // INPUT with the KEYBDINPUT member, laid out for x64 (40 bytes: the union is sized by MOUSEINPUT).
    koffi.struct('KEYINPUT64', { type: 'uint32', pad0: 'uint32', wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', pad1: 'uint32', dwExtraInfo: 'uint64', pad2: 'uint64' })
    api = {
      notificationState: shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int32_t* pquns)') as (out: Int32Array) => number,
      foreground: user32.func('void* __stdcall GetForegroundWindow()') as () => unknown,
      keyState: user32.func('short __stdcall GetAsyncKeyState(int vKey)') as (key: number) => number,
      sendInput: user32.func('uint32 __stdcall SendInput(uint32 cInputs, KEYINPUT64 *pInputs, int cbSize)') as (count: number, input: Record<string, number>, size: number) => number,
      windowText: user32.func('int __stdcall GetWindowTextW(void* hWnd, _Out_ uint16_t* lpString, int nMaxCount)') as (hwnd: unknown, buffer: Uint16Array, size: number) => number,
    }
  } catch {
    api = null
  }
  return api
}

export function foregroundWindowTitle() {
  const calls = win32()
  if (!calls) return ''
  const hwnd = calls.foreground()
  if (!hwnd) return ''
  const buffer = new Uint16Array(512)
  const length = calls.windowText(hwnd, buffer, buffer.length)
  return length > 0 ? String.fromCharCode(...buffer.subarray(0, length)) : ''
}

export function isTarkovTitle(name: string) {
  if (/companion|operations|chrome|cursor|code/i.test(name)) return false
  return /escape\s*from\s*tarkov|escapefromtarkov|\beft\b/i.test(name)
}

export function isTarkovForeground() {
  return isTarkovTitle(foregroundWindowTitle())
}

export function isVirtualKeyDown(key: number) { return Boolean((win32()?.keyState(key) ?? 0) & 0x8000) }
export function nativeKeysAvailable() { return Boolean(win32()) }

/**
 * How Windows sees the foreground full-screen app (SHQueryUserNotificationState):
 * - `exclusive`: a Direct3D exclusive full-screen game. Nothing can be drawn over it —
 *   the same limit every overlay (TarkovRaidCompass, TarkovQuestie, Discord) has.
 * - `fullscreen`: a borderless / optimized full-screen app. Topmost windows are shown over it.
 * - `normal`: nothing full-screen in front.
 */
export type DisplayMode = 'exclusive' | 'fullscreen' | 'normal' | 'unknown'

export function foregroundDisplayMode(): DisplayMode {
  const calls = win32()
  if (!calls) return 'unknown'
  try {
    const out = new Int32Array(1)
    if (calls.notificationState(out) !== 0) return 'unknown'
    const state = out[0]
    if (state === 3) return 'exclusive'
    if (state === 2 || state === 4) return 'fullscreen'
    return 'normal'
  } catch {
    return 'unknown'
  }
}

const INPUT_KEYBOARD = 1
const KEYEVENTF_EXTENDEDKEY = 0x0001
const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_SCANCODE = 0x0008
const VK_SNAPSHOT = 0x2c
/** PrintScreen is the extended scan code E0 37. */
const SCAN_PRINTSCREEN = 0x37

function key(flags: number) {
  return { type: INPUT_KEYBOARD, pad0: 0, wVk: VK_SNAPSHOT, wScan: SCAN_PRINTSCREEN, dwFlags: flags, time: 0, pad1: 0, dwExtraInfo: 0, pad2: 0 }
}

/**
 * Presses the game's screenshot key like a real keyboard: scan code + extended flag and a short hold, so a
 * game that samples input once per frame sees it. Returns false when native input is unavailable.
 */
export async function pressScreenshotKey(holdMs = 60) {
  const calls = win32()
  if (!calls) return false
  try {
    const flags = KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY
    if (calls.sendInput(1, key(flags), 40) !== 1) return false
    await new Promise((resolve) => setTimeout(resolve, holdMs))
    calls.sendInput(1, key(flags | KEYEVENTF_KEYUP), 40)
    return true
  } catch {
    return false
  }
}
