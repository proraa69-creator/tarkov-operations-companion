import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type Koffi = { load: (name: string) => { func: (signature: string) => (...args: unknown[]) => unknown } }

let api: {
  foreground: () => unknown
  windowText: (hwnd: unknown, buffer: Uint16Array, size: number) => number
  keyState: (key: number) => number
} | null | undefined

function win32() {
  if (api !== undefined) return api
  try {
    if (process.platform !== 'win32') throw new Error('not windows')
    const user32 = (require('koffi') as Koffi).load('user32.dll')
    api = {
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
