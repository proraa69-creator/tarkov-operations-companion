import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type Koffi = {
  load: (name: string) => { func: (signature: string) => (...args: unknown[]) => unknown }
  struct: (name: string, fields: Record<string, string>) => unknown
  address: (pointer: unknown) => bigint
}

let api: {
  notificationState: (out: Int32Array) => number
  foreground: () => unknown
  windowText: (hwnd: unknown, buffer: Uint16Array, size: number) => number
  keyState: (key: number) => number
  isAdmin: (() => number) | null
  shellExecute: ((hwnd: unknown, verb: string, file: string, params: string, dir: string | null, show: number) => number | bigint) | null
  gdi: Gdi | null
  windows: Windows | null
  inputChild: InputChild | null
} | null | undefined

/** Window handles as numbers (intptr_t): Electron's getNativeWindowHandle() is a buffer holding the handle, and a buffer
 * passed as a pointer would hand over the buffer's address instead. */
interface InputChild {
  find: (parent: number | bigint, after: number | bigint, className: string, title: string | null) => number | bigint
  visible: (hwnd: number | bigint) => boolean
}

interface Windows {
  find: (className: string | null, title: string | null) => unknown
  minimized: (hwnd: unknown) => boolean
  visible: (hwnd: unknown) => boolean
  clientRect: (hwnd: unknown, rect: Record<string, number>) => boolean
  clientToScreen: (hwnd: unknown, point: Record<string, number>) => boolean
  fromPoint: (point: { x: number; y: number }) => unknown
  ancestor: (hwnd: unknown, flags: number) => unknown
  address: (pointer: unknown) => bigint
}

interface Gdi {
  getDC: (hwnd: unknown) => unknown
  releaseDC: (hwnd: unknown, dc: unknown) => number
  createCompatibleDC: (dc: unknown) => unknown
  createCompatibleBitmap: (dc: unknown, width: number, height: number) => unknown
  selectObject: (dc: unknown, object: unknown) => unknown
  bitBlt: (dc: unknown, x: number, y: number, width: number, height: number, source: unknown, sx: number, sy: number, rop: number) => boolean
  getDIBits: (dc: unknown, bitmap: unknown, start: number, lines: number, bits: Uint8Array, info: Record<string, number>, usage: number) => number
  deleteObject: (object: unknown) => boolean
  deleteDC: (dc: unknown) => boolean
}
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
    api = {
      notificationState: shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int32_t* pquns)') as (out: Int32Array) => number,
      foreground: user32.func('void* __stdcall GetForegroundWindow()') as () => unknown,
      keyState: user32.func('short __stdcall GetAsyncKeyState(int vKey)') as (key: number) => number,
      windowText: user32.func('int __stdcall GetWindowTextW(void* hWnd, _Out_ uint16_t* lpString, int nMaxCount)') as (hwnd: unknown, buffer: Uint16Array, size: number) => number,
      isAdmin: optional(() => shell32.func('int __stdcall IsUserAnAdmin()') as () => number),
      shellExecute: optional(() => shell32.func('intptr_t __stdcall ShellExecuteW(void* hwnd, const char16_t* lpOperation, const char16_t* lpFile, const char16_t* lpParameters, const char16_t* lpDirectory, int nShowCmd)') as (hwnd: unknown, verb: string, file: string, params: string, dir: string | null, show: number) => number | bigint),
      gdi: optional(() => {
        const gdi32 = koffi.load('gdi32.dll')
        // BITMAPINFOHEADER plus room for the colour masks GetDIBits may write after it.
        koffi.struct('BITMAPINFO_EX', {
          biSize: 'uint32', biWidth: 'int32', biHeight: 'int32', biPlanes: 'uint16', biBitCount: 'uint16', biCompression: 'uint32',
          biSizeImage: 'uint32', biXPelsPerMeter: 'int32', biYPelsPerMeter: 'int32', biClrUsed: 'uint32', biClrImportant: 'uint32',
          mask0: 'uint32', mask1: 'uint32', mask2: 'uint32', mask3: 'uint32',
        })
        return {
          getDC: user32.func('void* __stdcall GetDC(void* hWnd)'),
          releaseDC: user32.func('int __stdcall ReleaseDC(void* hWnd, void* hDC)'),
          createCompatibleDC: gdi32.func('void* __stdcall CreateCompatibleDC(void* hdc)'),
          createCompatibleBitmap: gdi32.func('void* __stdcall CreateCompatibleBitmap(void* hdc, int cx, int cy)'),
          selectObject: gdi32.func('void* __stdcall SelectObject(void* hdc, void* h)'),
          bitBlt: gdi32.func('bool __stdcall BitBlt(void* hdc, int x, int y, int cx, int cy, void* hdcSrc, int x1, int y1, uint32 rop)'),
          getDIBits: gdi32.func('int __stdcall GetDIBits(void* hdc, void* hbm, uint32 start, uint32 cLines, _Out_ uint8_t* lpvBits, _Inout_ BITMAPINFO_EX* lpbmi, uint32 usage)'),
          deleteObject: gdi32.func('bool __stdcall DeleteObject(void* ho)'),
          deleteDC: gdi32.func('bool __stdcall DeleteDC(void* hdc)'),
        } as unknown as Gdi
      }),
      windows: optional(() => {
        koffi.struct('RAIDOS_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
        koffi.struct('RAIDOS_POINT', { x: 'int32', y: 'int32' })
        return {
          find: user32.func('void* __stdcall FindWindowW(const char16_t* lpClassName, const char16_t* lpWindowName)'),
          minimized: user32.func('bool __stdcall IsIconic(void* hWnd)'),
          visible: user32.func('bool __stdcall IsWindowVisible(void* hWnd)'),
          clientRect: user32.func('bool __stdcall GetClientRect(void* hWnd, _Out_ RAIDOS_RECT* lpRect)'),
          clientToScreen: user32.func('bool __stdcall ClientToScreen(void* hWnd, _Inout_ RAIDOS_POINT* lpPoint)'),
          fromPoint: user32.func('void* __stdcall WindowFromPoint(RAIDOS_POINT Point)'),
          ancestor: user32.func('void* __stdcall GetAncestor(void* hwnd, uint32 gaFlags)'),
          address: (pointer: unknown) => koffi.address(pointer),
        } as unknown as Windows
      }),
      inputChild: optional(() => ({
        find: user32.func('intptr_t __stdcall FindWindowExW(intptr_t hWndParent, intptr_t hWndChildAfter, const char16_t* lpszClass, const char16_t* lpszWindow)'),
        visible: user32.func('bool __stdcall IsWindowVisible(intptr_t hWnd)'),
      }) as unknown as InputChild),
    }
  } catch (error) {
    api = null
    loadError = process.platform === 'win32' ? (error instanceof Error ? error.message : String(error)) || 'unknown error' : ''
  }
  return api
}

/**
 * Whether Chromium's input window inside an app window is shown. Chromium takes the mouse through a child window of
 * class «Chrome_RenderWidgetHostHWND»; while it is hidden, every press on a window that cannot be activated (the
 * overlays) is dropped by Windows. `handle` is Electron's getNativeWindowHandle(). Null when it cannot be told: not
 * Windows, the functions are missing, or no such child.
 */
export function inputChildVisible(handle: Buffer): boolean | null {
  const calls = win32()?.inputChild
  if (!calls || handle.length < 4) return null
  try {
    const raw = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))
    const parent = raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : raw
    if (!parent) return null
    const child = calls.find(parent, 0, 'Chrome_RenderWidgetHostHWND', null)
    if (!child) return null
    return Boolean(calls.visible(child))
  } catch {
    return null
  }
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
  return hwnd ? windowTitle(calls, hwnd) : ''
}

export function isTarkovTitle(name: string) {
  if (/companion|operations|chrome|cursor|code/i.test(name)) return false
  return /escape\s*from\s*tarkov|escapefromtarkov|\beft\b/i.test(name)
}

export function isTarkovForeground() {
  return isTarkovTitle(foregroundWindowTitle())
}

const GA_ROOT = 2

/** Whether the game's window can be found and copied (visibleGameRect + captureScreenRegion). */
export function gameCaptureAvailable() {
  const calls = win32()
  return Boolean(calls?.windows && calls.gdi)
}

/**
 * The game's picture on screen (physical pixels) while the player can see it: the game in front, or its window open
 * and uncovered on another monitor (the app on one screen, the stash on the other). Null when it is minimised, covered
 * by another window (its picture would then be of that window — this app's own item list among them) or not running,
 * and when the Windows functions are unavailable.
 */
export function visibleGameRect(): { x: number; y: number; width: number; height: number } | null {
  const calls = win32()
  const windows = calls?.windows
  if (!calls || !windows) return null
  try {
    const front = calls.foreground()
    const inFront = Boolean(front) && isTarkovTitle(windowTitle(calls, front))
    // The game's window is «EscapeFromTarkov» of the Unity window class.
    const found = inFront ? front : windows.find(null, 'EscapeFromTarkov') || windows.find('UnityWndClass', null)
    const hwnd = found && (inFront || isTarkovTitle(windowTitle(calls, found))) ? found : null
    if (!hwnd || windows.minimized(hwnd) || !windows.visible(hwnd)) return null
    const rect = { left: 0, top: 0, right: 0, bottom: 0 }
    const origin = { x: 0, y: 0 }
    if (!windows.clientRect(hwnd, rect) || !windows.clientToScreen(hwnd, origin)) return null
    const width = rect.right - rect.left, height = rect.bottom - rect.top
    if (width < 320 || height < 240) return null
    if (!inFront) {
      const game = windows.address(hwnd)
      for (const fx of [0.1, 0.5, 0.9]) {
        for (const fy of [0.1, 0.5, 0.9]) {
          const hit = windows.fromPoint({ x: Math.round(origin.x + width * fx), y: Math.round(origin.y + height * fy) })
          const root = hit ? windows.ancestor(hit, GA_ROOT) : null
          if (!root || windows.address(root) !== game) return null
        }
      }
    }
    return { x: origin.x, y: origin.y, width, height }
  } catch {
    return null
  }
}

function windowTitle(calls: NonNullable<ReturnType<typeof win32>>, hwnd: unknown) {
  const buffer = new Uint16Array(512)
  const length = calls.windowText(hwnd, buffer, buffer.length)
  return length > 0 ? String.fromCharCode(...buffer.subarray(0, length)) : ''
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

const SRCCOPY = 0x00cc0020

/**
 * A copy of a screen area (physical pixels) as top-down BGRA — a few milliseconds, against hundreds for a
 * full-screen desktopCapturer grab. Reads the composed desktop only; nothing touches the game process.
 * Null when unavailable (not Windows) or when Windows refused.
 */
export function captureScreenRegion(x: number, y: number, width: number, height: number): { width: number; height: number; data: Uint8Array } | null {
  const gdi = win32()?.gdi
  if (!gdi || width <= 0 || height <= 0) return null
  const screenDC = gdi.getDC(null)
  if (!screenDC) return null
  const memoryDC = gdi.createCompatibleDC(screenDC)
  const bitmap = memoryDC ? gdi.createCompatibleBitmap(screenDC, width, height) : null
  const previous = memoryDC && bitmap ? gdi.selectObject(memoryDC, bitmap) : null
  try {
    // Plain SRCCOPY: CAPTUREBLT (layered windows too) hides and shows the cursor around every copy — the cursor flickered
    // with each scan — and only adds our own overlays to the picture.
    if (!memoryDC || !bitmap || !gdi.bitBlt(memoryDC, 0, 0, width, height, screenDC, x, y, SRCCOPY)) return null
    // GetDIBits wants the bitmap unselected.
    gdi.selectObject(memoryDC, previous)
    const data = new Uint8Array(width * height * 4)
    const info = { biSize: 40, biWidth: width, biHeight: -height, biPlanes: 1, biBitCount: 32, biCompression: 0, biSizeImage: 0, biXPelsPerMeter: 0, biYPelsPerMeter: 0, biClrUsed: 0, biClrImportant: 0, mask0: 0, mask1: 0, mask2: 0, mask3: 0 }
    const lines = gdi.getDIBits(memoryDC, bitmap, 0, height, data, info, 0)
    return lines === height ? { width, height, data } : null
  } catch {
    return null
  } finally {
    if (bitmap) gdi.deleteObject(bitmap)
    if (memoryDC) gdi.deleteDC(memoryDC)
    gdi.releaseDC(null, screenDC)
  }
}
