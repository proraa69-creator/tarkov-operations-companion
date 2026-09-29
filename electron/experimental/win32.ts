import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { release } from 'node:os'

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
  scanCode: (code: number, mapType: number) => number
  isAdmin: (() => number) | null
  shellExecute: ((hwnd: unknown, verb: string, file: string, params: string, dir: string | null, show: number) => number | bigint) | null
} | null | undefined
/** Why the Windows functions could not be loaded (shown on the Mini Map page); empty when they work. */
let loadError = ''

function win32() {
  if (api !== undefined) return api
  try {
    if (process.platform !== 'win32') throw new Error('not windows')
    const koffi = require('koffi') as Koffi
    const user32 = koffi.load('user32.dll')
    const shell32 = koffi.load('shell32.dll')
    const optional = <T>(load: () => T) => { try { return load() } catch { return null } }
    // INPUT with the KEYBDINPUT member, laid out for x64 (40 bytes: the union is sized by MOUSEINPUT).
    koffi.struct('KEYINPUT64', { type: 'uint32', pad0: 'uint32', wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', pad1: 'uint32', dwExtraInfo: 'uint64', pad2: 'uint64' })
    api = {
      notificationState: shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int32_t* pquns)') as (out: Int32Array) => number,
      foreground: user32.func('void* __stdcall GetForegroundWindow()') as () => unknown,
      keyState: user32.func('short __stdcall GetAsyncKeyState(int vKey)') as (key: number) => number,
      sendInput: user32.func('uint32 __stdcall SendInput(uint32 cInputs, KEYINPUT64 *pInputs, int cbSize)') as (count: number, input: Record<string, number>, size: number) => number,
      windowText: user32.func('int __stdcall GetWindowTextW(void* hWnd, _Out_ uint16_t* lpString, int nMaxCount)') as (hwnd: unknown, buffer: Uint16Array, size: number) => number,
      scanCode: user32.func('uint32 __stdcall MapVirtualKeyW(uint32 uCode, uint32 uMapType)') as (code: number, mapType: number) => number,
      isAdmin: optional(() => shell32.func('int __stdcall IsUserAnAdmin()') as () => number),
      shellExecute: optional(() => shell32.func('intptr_t __stdcall ShellExecuteW(void* hwnd, const char16_t* lpOperation, const char16_t* lpFile, const char16_t* lpParameters, const char16_t* lpDirectory, int nShowCmd)') as (hwnd: unknown, verb: string, file: string, params: string, dir: string | null, show: number) => number | bigint),
    }
  } catch (error) {
    api = null
    loadError = process.platform === 'win32' ? (error instanceof Error ? error.message : String(error)) || 'unknown error' : ''
  }
  return api
}

/** Empty when the Windows functions (game window, key state, key presses) are available. */
export function nativeError() {
  win32()
  return loadError
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
/** Down now (0x8000) or pressed since the previous query (0x0001). */
export function wasVirtualKeyPressed(key: number) { return Boolean((win32()?.keyState(key) ?? 0) & 0x8001) }
export function nativeKeysAvailable() { return Boolean(win32()) }

let elevated: boolean | null | undefined
/**
 * Whether this app runs with administrator rights; null when unknown. The BSG launcher starts the game
 * elevated, and Windows then hides the game's key state from, and drops key presses sent by, apps that are not.
 */
export function isElevated(): boolean | null {
  if (elevated !== undefined) return elevated
  try {
    const check = win32()?.isAdmin
    elevated = check ? check() !== 0 : null
  } catch {
    elevated = null
  }
  return elevated
}

/** Starts `file` with administrator rights (the Windows consent prompt). False when refused or unavailable. */
export function runElevated(file: string, params: string, dir: string) {
  const shellExecute = win32()?.shellExecute
  if (!shellExecute) return false
  try {
    return Number(shellExecute(null, 'runas', file, params, dir || null, 1)) > 32
  } catch {
    return false
  }
}

/**
 * Whether Windows opens the Snipping Tool on PrtSc (and so keeps the key from the game). The value is
 * missing until the player changes the setting; Windows 11 then does it by default, Windows 10 does not.
 */
export function printScreenOpensSnipping(): Promise<'on' | 'off' | 'unknown'> {
  if (process.platform !== 'win32') return Promise.resolve('unknown')
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Control Panel\\Keyboard', '/v', 'PrintScreenKeyForSnippingEnabled'], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
      const value = /PrintScreenKeyForSnippingEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(String(stdout ?? ''))
      if (value) { resolve(parseInt(value[1]!, 16) ? 'on' : 'off'); return }
      const build = Number(release().split('.')[2])
      resolve(error && Number.isFinite(build) ? (build >= 22000 ? 'on' : 'off') : 'unknown')
    })
  })
}

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
const MAPVK_VK_TO_VSC = 0
const VK_SNAPSHOT = 0x2c
/** PrintScreen is the extended scan code E0 37 (MapVirtualKey answers with the Alt+SysRq code). */
const SCAN_PRINTSCREEN = 0x37
/** Pause and Num Lock share scan code 45 and are only told apart by their virtual key. */
const BY_VIRTUAL_KEY = new Set([0x13, 0x90])

export interface KeyStroke { vk: number; extended: boolean }

type Calls = NonNullable<ReturnType<typeof win32>>

function keyInput(calls: Calls, { vk, extended }: KeyStroke, up: boolean) {
  const scan = vk === VK_SNAPSHOT ? SCAN_PRINTSCREEN : calls.scanCode(vk, MAPVK_VK_TO_VSC) & 0xff
  let flags = scan && !BY_VIRTUAL_KEY.has(vk) ? KEYEVENTF_SCANCODE : 0
  if (extended) flags |= KEYEVENTF_EXTENDEDKEY
  if (up) flags |= KEYEVENTF_KEYUP
  return { type: INPUT_KEYBOARD, pad0: 0, wVk: vk, wScan: scan, dwFlags: flags, time: 0, pad1: 0, dwExtraInfo: 0, pad2: 0 }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Presses the game's screenshot key (or combination) like a real keyboard: scan codes, the keys held
 * together for a moment so a game that samples input once per frame sees them, then released in
 * reverse order — always, so no key stays stuck. False when native input is unavailable.
 * Windows reports success even when it drops the input for an elevated game (see isElevated).
 */
export async function pressKeys(strokes: KeyStroke[], holdMs = 60) {
  const calls = win32()
  if (!calls || !strokes.length) return false
  const down: KeyStroke[] = []
  try {
    for (const stroke of strokes) {
      if (down.length) await pause(15)
      if (calls.sendInput(1, keyInput(calls, stroke, false), 40) !== 1) return false
      down.push(stroke)
    }
    await pause(holdMs)
    return true
  } catch {
    return false
  } finally {
    for (const stroke of down.reverse()) {
      try { calls.sendInput(1, keyInput(calls, stroke, true), 40) } catch { /* nothing more to release */ }
    }
  }
}
