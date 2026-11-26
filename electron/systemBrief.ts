/**
 * A few words about the computer for a report of the «Скорость и зависания» category (report 227, owner 25.11.2026: «проверь,
 * может ли быть проблема в его ноутбуке»): the video cards (maker and model number from their PCI ids, `*` marks the one
 * the app draws with — on a laptop with two cards that is mostly the built-in one, the game should be on the other), the
 * memory and whether it runs on battery. Nothing personal: no names, no serial numbers, no driver paths. It goes into the
 * report's «Система» line (src/app/support.ts withSystemBrief), which the player sees in the report window before sending.
 */

const VENDORS: Record<number, string> = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel', 0x1414: 'Microsoft', 0x5143: 'Qualcomm' }
const hex = (value: number) => value.toString(16).padStart(4, '0')

/** At most this long: the line goes into the report's platform field (160 characters with the rest). */
export const SYSTEM_BRIEF_MAX = 80

export interface SystemBriefInput {
  /** app.getGPUInfo('basic') */
  gpuInfo: unknown
  /** os.totalmem() */
  totalMemBytes: number
  /** powerMonitor.isOnBatteryPower() */
  onBattery: boolean
}

/** «GPU NVIDIA 28e0, *Intel a7a0; RAM 16 GB; battery» (Microsoft 1414: Windows' basic driver, no real driver installed). */
export function describeSystemBrief(input: SystemBriefInput) {
  const devices = input.gpuInfo && typeof input.gpuInfo === 'object' && Array.isArray((input.gpuInfo as { gpuDevice?: unknown }).gpuDevice)
    ? (input.gpuInfo as { gpuDevice: unknown[] }).gpuDevice
    : []
  const cards = devices.slice(0, 4).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const device = entry as { vendorId?: unknown; deviceId?: unknown; active?: unknown }
    const vendor = typeof device.vendorId === 'number' ? device.vendorId : 0
    const id = typeof device.deviceId === 'number' ? device.deviceId : 0
    if (!vendor && !id) return []
    return [`${device.active === true ? '*' : ''}${VENDORS[vendor] ?? hex(vendor)} ${hex(id)}`]
  })
  const gb = input.totalMemBytes > 0 ? Math.round(input.totalMemBytes / 1024 ** 3) : 0
  const parts = [cards.length ? `GPU ${cards.join(', ')}` : '', gb ? `RAM ${gb} GB` : '', input.onBattery ? 'battery' : 'AC']
  return parts.filter(Boolean).join('; ').slice(0, SYSTEM_BRIEF_MAX)
}
