import { createRequire } from 'node:module'
import type { BrowserWindow } from 'electron'

/**
 * Alt + the mouse wheel steps the map's floors while the game has the focus (owner, 08.11.2026: «у человека два монитора,
 * приложение открыто на втором мониторе, а на первом мониторе игра. И не переключаясь из игры, он может перелистать этаж
 * карты»). Only while the map page asks for it — for the accounts the server gives `mapFloorWheel` (src/maps/mapFloorWheel.tsx).
 *
 * No hook and no input into the game. Alt is polled (GetAsyncKeyState, like the app's other in-game keys); while it is held
 * and the app's window is not the focused one, the mouse is registered for raw input to the app's window
 * (RegisterRawInputDevices with RIDEV_INPUTSINK: Windows gives a copy of the mouse's input to every program that asks, the
 * game gets its own unchanged and nothing is blocked); the wheel's turns become floor steps sent to the page. Alt let go (or
 * the app's window focused, where the page reads the wheel itself), the registration is removed, so a fast mouse costs nothing
 * the rest of the time.
 */

const require = createRequire(import.meta.url)

const VK_MENU = 0x12
const WM_INPUT = 0x00ff
const RID_INPUT = 0x10000003
const RIM_TYPEMOUSE = 0
const RI_MOUSE_WHEEL = 0x0400
const RIDEV_REMOVE = 0x00000001
const RIDEV_INPUTSINK = 0x00000100
/** RAWINPUTHEADER on 64-bit Windows: dwType, dwSize, hDevice, wParam. */
const HEADER_SIZE = 24
const POLL_MS = 40
/** One mouse notch is 120; half of it makes a step, so a touchpad's small turns add up. */
const STEP = 60
/** After a step, the rest of the same flick is let go. */
const PAUSE_MS = 180

/** The wheel's turn in a RAWINPUT (64-bit layout): positive is away from the player (up); null when it is not a wheel turn. */
export function wheelDelta(bytes: Uint8Array): number | null {
  if (bytes.length < HEADER_SIZE + 8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== RIM_TYPEMOUSE) return null
  // RAWMOUSE: usFlags (2), padding (2), then usButtonFlags and usButtonData
  const flags = view.getUint16(HEADER_SIZE + 4, true)
  if (!(flags & RI_MOUSE_WHEEL)) return null
  return view.getInt16(HEADER_SIZE + 6, true)
}

/**
 * When to listen and what a turn means: `tick` with Alt and the window's focus says whether the mouse should be registered;
 * `turn` adds a wheel turn and gives a step (1 up, −1 down) once a half notch has gathered, then lets the same flick go.
 */
export function floorWheelState() {
  let travel = 0
  let pausedUntil = 0
  return {
    tick({ altDown, appFocused }: { altDown: boolean; appFocused: boolean }) {
      const listen = altDown && !appFocused
      if (!listen) travel = 0
      return listen
    },
    turn(delta: number, now: number): 1 | -1 | null {
      if (now < pausedUntil) return null
      travel += delta
      if (Math.abs(travel) < STEP) return null
      const step = travel > 0 ? 1 : -1
      travel = 0
      pausedUntil = now + PAUSE_MS
      return step
    },
  }
}

type Koffi = {
  load: (name: string) => { func: (signature: string) => (...args: unknown[]) => unknown }
  struct: (name: string, fields: Record<string, string>) => unknown
  as: (value: unknown, type: string) => unknown
}

interface RawInputApi {
  keyState: (key: number) => number
  register: (devices: Array<Record<string, unknown>>, count: number, size: number) => boolean
  read: (handle: unknown, command: number, data: Uint8Array, size: Uint32Array, headerSize: number) => number
  pointer: (address: bigint) => unknown
}

let raw: RawInputApi | null | undefined

function rawInput(): RawInputApi | null {
  if (raw !== undefined) return raw
  try {
    if (process.platform !== 'win32') throw new Error('not windows')
    const koffi = require('koffi') as Koffi
    const user32 = koffi.load('user32.dll')
    koffi.struct('RAIDOS_RAWINPUTDEVICE', { usUsagePage: 'uint16', usUsage: 'uint16', dwFlags: 'uint32', hwndTarget: 'void *' })
    raw = {
      keyState: user32.func('short __stdcall GetAsyncKeyState(int vKey)') as RawInputApi['keyState'],
      register: user32.func('bool __stdcall RegisterRawInputDevices(RAIDOS_RAWINPUTDEVICE *pRawInputDevices, uint32 uiNumDevices, uint32 cbSize)') as RawInputApi['register'],
      read: user32.func('uint32 __stdcall GetRawInputData(void *hRawInput, uint32 uiCommand, _Out_ uint8_t *pData, _Inout_ uint32_t *pcbSize, uint32 cbSizeHeader)') as RawInputApi['read'],
      pointer: (address) => koffi.as(Number(address), 'void *'),
    }
  } catch {
    raw = null
  }
  return raw
}

const handleOf = (buffer: Buffer) => (buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0)))

let enabled = false
let timer: ReturnType<typeof setInterval> | null = null
let registered = false
let hooked: BrowserWindow | null = null
let windowOf: () => BrowserWindow | null = () => null
const state = floorWheelState()
const data = new Uint8Array(64)
const size = new Uint32Array(1)

function setRegistered(listen: boolean, win: BrowserWindow, api: RawInputApi) {
  if (listen === registered) return
  const device = listen
    ? { usUsagePage: 1, usUsage: 2, dwFlags: RIDEV_INPUTSINK, hwndTarget: api.pointer(handleOf(win.getNativeWindowHandle())) }
    : { usUsagePage: 1, usUsage: 2, dwFlags: RIDEV_REMOVE, hwndTarget: null }
  try { if (api.register([device], 1, 16)) registered = listen } catch { /* stays as it was */ }
}

function onInput(win: BrowserWindow, api: RawInputApi, lParam: Buffer) {
  if (!registered) return
  size[0] = data.length
  try {
    if (api.read(api.pointer(handleOf(lParam)), RID_INPUT, data, size, HEADER_SIZE) === 0xffffffff) return
  } catch { return }
  const delta = wheelDelta(data)
  if (delta === null) return
  const step = state.turn(delta, Date.now())
  if (step && !win.isDestroyed()) win.webContents.send('map:floor-step', step)
}

function stopListening() {
  if (timer) clearInterval(timer)
  timer = null
  const api = raw
  if (hooked && !hooked.isDestroyed()) {
    if (api && registered) setRegistered(false, hooked, api)
    try { hooked.unhookWindowMessage(WM_INPUT) } catch { /* the window went */ }
  }
  registered = false
  hooked = null
}

/** The page's ask: on while the map is open with the account's `mapFloorWheel`, off when it closes. */
export function setMapFloorWheel(on: boolean) {
  if (on === enabled) return
  enabled = on
  if (!on) { stopListening(); return }
  const api = rawInput()
  const win = windowOf()
  if (!api || !win || win.isDestroyed()) return
  hooked = win
  win.hookWindowMessage(WM_INPUT, (_wParam, lParam) => onInput(win, api, lParam))
  timer = setInterval(() => {
    if (win.isDestroyed()) { stopListening(); return }
    const listen = state.tick({ altDown: Boolean(api.keyState(VK_MENU) & 0x8000), appFocused: win.isFocused() })
    setRegistered(listen, win, api)
  }, POLL_MS)
}

export function startMapFloorWheel(mainWindow: () => BrowserWindow | null) {
  windowOf = mainWindow
}

export function stopMapFloorWheel() {
  enabled = false
  stopListening()
}
