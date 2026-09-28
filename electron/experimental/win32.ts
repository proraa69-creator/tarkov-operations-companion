import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type Koffi = { load: (name: string) => { func: (signature: string) => (...args: unknown[]) => unknown } }

let api: {
  notificationState: (out: Int32Array) => number
  foreground: () => unknown
  windowText: (hwnd: unknown, buffer: Uint16Array, size: number) => number
  keyState: (key: number) => number
} | null | undefined

function win32() {
  if (api !== undefined) return api
  try {
    if (process.platform !== 'win32') throw new Error('not windows')
    const koffi = require('koffi') as Koffi
    const user32 = koffi.load('user32.dll')
    const shell32 = koffi.load('shell32.dll')
    api = {
      notificationState: shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int32_t* pquns)') as (out: Int32Array) => number,
      foreground: user32.func('void* __stdcall GetForegroundWindow()') as () => unknown,
      keyState: user32.func('short __stdcall GetAsyncKeyState(int vKey)') as (key: number) => number,
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
