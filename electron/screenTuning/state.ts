import { BUILT_IN_PRESETS, cleanProfile, gammaRamp, weakerTables, type ScreenProfile, type ScreenTables } from '../../src/screen/screenCurve.js'

/**
 * What «Настройка экрана» keeps (screen-tuning.json in the app's data folder): the player's own presets, the chosen one,
 * whether it is on and when it shows. Our presets live in the code (src/screen/screenCurve.ts BUILT_IN_PRESETS).
 */
export interface ScreenTuningSettings {
  presets: ScreenProfile[]
  activeId: string
  enabled: boolean
  /** `game`: only while the game's window is in front (the desktop and this app look as usual); `always`: all the time. */
  when: 'game' | 'always'
}

export const DEFAULT_SETTINGS: ScreenTuningSettings = { presets: [], activeId: 'builtin-night-soft', enabled: false, when: 'game' }

export const MAX_PRESETS = 30

export function cleanSettings(value: unknown): ScreenTuningSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const builtIn = new Set(BUILT_IN_PRESETS.map((preset) => preset.id))
  const seen = new Set<string>()
  const presets = (Array.isArray(raw.presets) ? raw.presets : [])
    .map(cleanProfile)
    .filter((preset): preset is ScreenProfile => Boolean(preset) && !builtIn.has(preset!.id) && !seen.has(preset!.id) && Boolean(seen.add(preset!.id)))
    .slice(0, MAX_PRESETS)
  const ids = new Set([...builtIn, ...presets.map((preset) => preset.id)])
  const activeId = typeof raw.activeId === 'string' && ids.has(raw.activeId) ? raw.activeId : DEFAULT_SETTINGS.activeId
  return { presets, activeId, enabled: raw.enabled === true, when: raw.when === 'always' ? 'always' : 'game' }
}

export function allPresets(settings: ScreenTuningSettings): ScreenProfile[] {
  return [...BUILT_IN_PRESETS, ...settings.presets]
}

export function activePreset(settings: ScreenTuningSettings): ScreenProfile {
  return allPresets(settings).find((preset) => preset.id === settings.activeId) ?? BUILT_IN_PRESETS[0]!
}

/** Adds or replaces one of the player's presets (ours cannot be overwritten: a copy gets a new id). */
export function savePreset(settings: ScreenTuningSettings, value: unknown, newId: () => string): { settings: ScreenTuningSettings; preset: ScreenProfile } {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const builtIn = BUILT_IN_PRESETS.some((preset) => preset.id === raw.id)
  const own = settings.presets.some((preset) => preset.id === raw.id)
  const preset = cleanProfile({ ...raw, id: own && !builtIn ? raw.id : newId() })
  if (!preset) throw new Error('Укажите название пресета')
  const exists = settings.presets.some((entry) => entry.id === preset.id)
  if (!exists && settings.presets.length >= MAX_PRESETS) throw new Error(`Можно сохранить до ${MAX_PRESETS} своих пресетов`)
  const presets = exists ? settings.presets.map((entry) => entry.id === preset.id ? preset : entry) : [...settings.presets, preset]
  return { settings: { ...settings, presets }, preset }
}

export function deletePreset(settings: ScreenTuningSettings, id: string): ScreenTuningSettings {
  const presets = settings.presets.filter((preset) => preset.id !== id)
  return { ...settings, presets, activeId: settings.activeId === id ? DEFAULT_SETTINGS.activeId : settings.activeId }
}

/**
 * Our tables on top of the monitor's own ramp (a colour-calibrated monitor keeps its calibration): the monitor's table
 * is read at the value ours gives.
 */
export function composeRamp(tables: ScreenTables, original: Uint16Array | null): Uint16Array {
  const ours = gammaRamp(tables)
  if (!original || original.length !== 768) return ours
  const result = new Uint16Array(768)
  for (let channel = 0; channel < 3; channel += 1) {
    for (let index = 0; index < 256; index += 1) {
      const position = ours[channel * 256 + index]! / 65535 * 255
      const low = Math.floor(position), high = Math.min(255, low + 1), t = position - low
      result[channel * 256 + index] = Math.round(original[channel * 256 + low]! * (1 - t) + original[channel * 256 + high]! * t)
    }
  }
  return result
}

/** The strengths tried in turn when Windows refuses a ramp (it limits how far one may go from a straight line). */
export const STRENGTHS = [1, 0.85, 0.7, 0.55, 0.4, 0.25] as const

/** Writes the strongest ramp Windows accepts; the strength used, or 0 when every one was refused. */
export function writeStrongest(tables: ScreenTables, original: Uint16Array | null, write: (ramp: Uint16Array) => boolean): number {
  for (const strength of STRENGTHS) if (write(composeRamp(weakerTables(tables, strength), original))) return strength
  return 0
}
