import { createRequire } from 'node:module'

/**
 * The Windows side of «Настройка экрана»: each monitor's gamma ramp (gdi32 SetDeviceGammaRamp, the same table Windows
 * colour calibration and «night light» tools use) and NVIDIA's «Цифровая интенсивность» (nvapi64.dll, what the NVIDIA
 * control panel sets). Both change what the monitor shows; neither touches the game's process, files or memory.
 */

const require = createRequire(import.meta.url)

type Fn = (...args: unknown[]) => unknown
type Koffi = {
  load: (name: string) => { func: (signature: string) => Fn }
  struct: (name: string, fields: Record<string, unknown>) => unknown
  array: (type: string, length: number, hint?: string) => unknown
  proto: (definition: string) => unknown
  call: (pointer: unknown, type: unknown, ...args: unknown[]) => unknown
}

interface Gdi {
  enumDevices: Fn
  createDC: Fn
  deleteDC: Fn
  getRamp: Fn
  setRamp: Fn
  monitorFromPoint: Fn
  monitorInfo: Fn
}

let gdi: Gdi | null | undefined
let koffi: Koffi | null = null

function load(): Gdi | null {
  if (gdi !== undefined) return gdi
  try {
    if (process.platform !== 'win32') throw new Error('not windows')
    koffi = require('koffi') as Koffi
    const user32 = koffi.load('user32.dll')
    const gdi32 = koffi.load('gdi32.dll')
    koffi.struct('RAIDOS_DISPLAY_DEVICE', {
      cb: 'uint32', DeviceName: koffi.array('char16_t', 32, 'String'), DeviceString: koffi.array('char16_t', 128, 'String'),
      StateFlags: 'uint32', DeviceID: koffi.array('char16_t', 128, 'String'), DeviceKey: koffi.array('char16_t', 128, 'String'),
    })
    koffi.struct('RAIDOS_SCREEN_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    koffi.struct('RAIDOS_SCREEN_POINT', { x: 'int32', y: 'int32' })
    koffi.struct('RAIDOS_MONITORINFOEX', {
      cbSize: 'uint32', rcMonitor: 'RAIDOS_SCREEN_RECT', rcWork: 'RAIDOS_SCREEN_RECT', dwFlags: 'uint32', szDevice: koffi.array('char16_t', 32, 'String'),
    })
    gdi = {
      enumDevices: user32.func('bool __stdcall EnumDisplayDevicesW(const char16_t* lpDevice, uint32 iDevNum, _Inout_ RAIDOS_DISPLAY_DEVICE* lpDisplayDevice, uint32 dwFlags)'),
      createDC: gdi32.func('void* __stdcall CreateDCW(const char16_t* pwszDriver, const char16_t* pwszDevice, const char16_t* pszPort, void* pdm)'),
      deleteDC: gdi32.func('bool __stdcall DeleteDC(void* hdc)'),
      getRamp: gdi32.func('bool __stdcall GetDeviceGammaRamp(void* hdc, _Out_ uint16_t* lpRamp)'),
      setRamp: gdi32.func('bool __stdcall SetDeviceGammaRamp(void* hdc, const uint16_t* lpRamp)'),
      monitorFromPoint: user32.func('void* __stdcall MonitorFromPoint(RAIDOS_SCREEN_POINT pt, uint32 dwFlags)'),
      monitorInfo: user32.func('bool __stdcall GetMonitorInfoW(void* hMonitor, _Inout_ RAIDOS_MONITORINFOEX* lpmi)'),
    }
  } catch {
    gdi = null
  }
  return gdi
}

const ATTACHED_TO_DESKTOP = 0x1
const MONITOR_DEFAULTTONEAREST = 2

/** The monitors shown on the desktop, by their Windows names («\\.\DISPLAY1»). */
export function displayNames(): string[] {
  const calls = load()
  if (!calls) return []
  const names: string[] = []
  try {
    for (let index = 0; index < 16; index += 1) {
      const device = { cb: 840, DeviceName: '', DeviceString: '', StateFlags: 0, DeviceID: '', DeviceKey: '' }
      if (!calls.enumDevices(null, index, device, 0)) break
      if (device.StateFlags & ATTACHED_TO_DESKTOP && device.DeviceName) names.push(device.DeviceName)
    }
  } catch { /* none */ }
  return names
}

/** The monitor a screen point is on («\\.\DISPLAY2»), or '' when unknown. */
export function displayAt(x: number, y: number): string {
  const calls = load()
  if (!calls) return ''
  try {
    const monitor = calls.monitorFromPoint({ x: Math.round(x), y: Math.round(y) }, MONITOR_DEFAULTTONEAREST)
    if (!monitor) return ''
    const info = { cbSize: 104, rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 }, rcWork: { left: 0, top: 0, right: 0, bottom: 0 }, dwFlags: 0, szDevice: '' }
    return calls.monitorInfo(monitor, info) ? info.szDevice : ''
  } catch {
    return ''
  }
}

function withDisplay<T>(name: string, action: (dc: unknown, calls: Gdi) => T): T | null {
  const calls = load()
  if (!calls) return null
  const dc = calls.createDC(null, name, null, null)
  if (!dc) return null
  try { return action(dc, calls) } catch { return null } finally { calls.deleteDC(dc) }
}

/** The ramp the monitor has now (768 values: red, green, blue), or null. */
export function readRamp(name: string): Uint16Array | null {
  return withDisplay(name, (dc, calls) => {
    const ramp = new Uint16Array(768)
    return calls.getRamp(dc, ramp) ? ramp : null
  })
}

/** Sets the monitor's ramp; false when Windows refused it (a ramp too far from a straight line) or the call failed. */
export function writeRamp(name: string, ramp: Uint16Array): boolean {
  return withDisplay(name, (dc, calls) => Boolean(calls.setRamp(dc, ramp))) ?? false
}

export function gammaAvailable() {
  return Boolean(load())
}

// ── NVIDIA «Цифровая интенсивность» (Digital Vibrance) ─────────────────────────────────────────────────────────────

/** nvapi_QueryInterface ids of the public NvAPI functions used here. */
const NVAPI = { initialize: 0x0150e828, enumDisplay: 0x9abdd40d, getDvcInfo: 0x4085de45, setDvcLevel: 0x172409b4 }

interface Nvidia {
  displays: unknown[]
  info: (display: unknown) => { current: number; min: number; max: number } | null
  set: (display: unknown, level: number) => boolean
}

let nvidia: Nvidia | null | undefined

function loadNvidia(): Nvidia | null {
  if (nvidia !== undefined) return nvidia
  nvidia = null
  try {
    if (process.platform !== 'win32' || process.arch !== 'x64') return null
    const ffi = koffi ?? (require('koffi') as Koffi)
    koffi = ffi
    const library = ffi.load('nvapi64.dll')
    const query = library.func('void* nvapi_QueryInterface(uint32 id)')
    const pointers = Object.fromEntries(Object.entries(NVAPI).map(([key, id]) => [key, query(id)])) as Record<keyof typeof NVAPI, unknown>
    if (Object.values(pointers).some((pointer) => !pointer)) return null
    ffi.struct('RAIDOS_NV_DVC_INFO', { version: 'uint32', currentLevel: 'int32', minLevel: 'int32', maxLevel: 'int32' })
    const initProto = ffi.proto('int RaidosNvInitialize()')
    const enumProto = ffi.proto('int RaidosNvEnumDisplay(uint32 index, _Out_ void** handle)')
    const infoProto = ffi.proto('int RaidosNvGetDvcInfo(void* handle, uint32 outputId, _Inout_ RAIDOS_NV_DVC_INFO* info)')
    const setProto = ffi.proto('int RaidosNvSetDvcLevel(void* handle, uint32 outputId, int32 level)')
    if (ffi.call(pointers.initialize, initProto) !== 0) return null
    const displays: unknown[] = []
    for (let index = 0; index < 8; index += 1) {
      const out = [null as unknown]
      if (ffi.call(pointers.enumDisplay, enumProto, index, out) !== 0 || !out[0]) break
      displays.push(out[0])
    }
    if (!displays.length) return null
    nvidia = {
      displays,
      info: (display) => {
        const info = { version: 16 | (1 << 16), currentLevel: 0, minLevel: 0, maxLevel: 0 }
        if (ffi.call(pointers.getDvcInfo, infoProto, display, 0, info) !== 0 || info.maxLevel <= info.minLevel) return null
        return { current: info.currentLevel, min: info.minLevel, max: info.maxLevel }
      },
      set: (display, level) => ffi.call(pointers.setDvcLevel, setProto, display, 0, Math.round(level)) === 0,
    }
  } catch {
    nvidia = null
  }
  return nvidia
}

/**
 * The control panel's percent and the driver's level: 50 % is level 0 (the default), 100 % the top level. Below 50 %
 * the panel goes grey, which never helps to see in the dark, so it is not offered.
 */
export const vibranceToLevel = (percent: number, max: number) => Math.round(Math.min(1, Math.max(0, (percent - 50) / 50)) * max)
export const levelToVibrance = (level: number, max: number) => max > 0 ? Math.round(50 + Math.min(1, Math.max(0, level / max)) * 50) : 50

/** NVIDIA's vibrance of the first display, in % (50…100); null without an NVIDIA card / driver. */
export function readVibrance(): number | null {
  const api = loadNvidia()
  const info = api ? api.info(api.displays[0]) : null
  return info ? levelToVibrance(info.current, info.max) : null
}

/** Sets the vibrance of every NVIDIA display; false when unavailable or refused. */
export function writeVibrance(percent: number): boolean {
  const api = loadNvidia()
  if (!api) return false
  let done = false
  for (const display of api.displays) {
    const info = api.info(display)
    if (info && api.set(display, vibranceToLevel(percent, info.max))) done = true
  }
  return done
}
