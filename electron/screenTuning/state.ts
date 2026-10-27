import { BUILT_IN_PRESETS, cleanProfile, gammaRamp, weakerTables, type ScreenProfile, type ScreenTables } from '../../src/screen/screenCurve.js'

/**
 * What «Настройка экрана» keeps (screen-tuning.json in the app's data folder): the player's own presets, the chosen one,
 * whether it is on, the monitor, and the player's names for our presets and the ones of ours taken off the list. Our
 * presets live in the code (src/screen/screenCurve.ts BUILT_IN_PRESETS).
 */
export interface ScreenTuningSettings {
  presets: ScreenProfile[]
  activeId: string
  enabled: boolean
  /**
   * The monitor the preset goes on («\\.\DISPLAY2»); '' — the one the game is on. Either way only while the game is on
   * that monitor and not covered (owner, 27.10.2026: «рабочий стол не должен применять этот пресет… только в игру»).
   */
  display: string
  /** Our presets the player renamed or took off the list, by id. */
  builtIns: Record<string, { name?: string; hidden?: boolean }>
}

export const DEFAULT_SETTINGS: ScreenTuningSettings = { presets: [], activeId: 'builtin-indoors', enabled: false, display: '', builtIns: {} }

export const MAX_PRESETS = 30

const isBuiltIn = (id: unknown) => BUILT_IN_PRESETS.some((preset) => preset.id === id)
const cleanName = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 48) : ''

export function cleanSettings(value: unknown): ScreenTuningSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const seen = new Set<string>()
  const presets = (Array.isArray(raw.presets) ? raw.presets : [])
    .map(cleanProfile)
    .filter((preset): preset is ScreenProfile => Boolean(preset) && !isBuiltIn(preset!.id) && !seen.has(preset!.id) && Boolean(seen.add(preset!.id)))
    .slice(0, MAX_PRESETS)
  const builtIns: ScreenTuningSettings['builtIns'] = {}
  const rawBuiltIns = raw.builtIns && typeof raw.builtIns === 'object' ? raw.builtIns as Record<string, Record<string, unknown>> : {}
  for (const [id, entry] of Object.entries(rawBuiltIns)) {
    if (!isBuiltIn(id) || !entry || typeof entry !== 'object') continue
    const name = cleanName(entry.name)
    if (name || entry.hidden === true) builtIns[id] = { ...(name ? { name } : {}), ...(entry.hidden === true ? { hidden: true } : {}) }
  }
  const display = typeof raw.display === 'string' && /^\\\\\.\\DISPLAY\d{1,2}$/.test(raw.display) ? raw.display : ''
  const result: ScreenTuningSettings = { presets, activeId: '', enabled: raw.enabled === true, display, builtIns }
  const ids = new Set(allPresets(result).map((preset) => preset.id))
  const fallback = allPresets(result)[0]?.id ?? BUILT_IN_PRESETS[0]!.id
  result.activeId = typeof raw.activeId === 'string' && ids.has(raw.activeId) ? raw.activeId : ids.has(DEFAULT_SETTINGS.activeId) ? DEFAULT_SETTINGS.activeId : fallback
  return result
}

/** The list the player sees: ours (renamed, without the ones taken off), then the player's own. */
export function allPresets(settings: ScreenTuningSettings): ScreenProfile[] {
  const ours = BUILT_IN_PRESETS
    .filter((preset) => !settings.builtIns[preset.id]?.hidden)
    .map((preset) => settings.builtIns[preset.id]?.name ? { ...preset, name: settings.builtIns[preset.id]!.name! } : preset)
  return [...ours, ...settings.presets]
}

export function activePreset(settings: ScreenTuningSettings): ScreenProfile {
  return allPresets(settings).find((preset) => preset.id === settings.activeId) ?? BUILT_IN_PRESETS[0]!
}

/** Adds or replaces one of the player's presets (ours cannot be overwritten: a copy gets a new id). */
export function savePreset(settings: ScreenTuningSettings, value: unknown, newId: () => string): { settings: ScreenTuningSettings; preset: ScreenProfile } {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const own = settings.presets.some((preset) => preset.id === raw.id)
  const preset = cleanProfile({ ...raw, id: own && !isBuiltIn(raw.id) ? raw.id : newId() })
  if (!preset) throw new Error('Укажите название пресета')
  const exists = settings.presets.some((entry) => entry.id === preset.id)
  if (!exists && settings.presets.length >= MAX_PRESETS) throw new Error(`Можно сохранить до ${MAX_PRESETS} своих пресетов`)
  const presets = exists ? settings.presets.map((entry) => entry.id === preset.id ? preset : entry) : [...settings.presets, preset]
  return { settings: { ...settings, presets }, preset }
}

/** A new name for any preset: ours keep their curve, only the name the player sees changes. */
export function renamePreset(settings: ScreenTuningSettings, id: string, name: unknown): ScreenTuningSettings {
  const clean = cleanName(name)
  if (!clean) throw new Error('Укажите название пресета')
  if (isBuiltIn(id)) return { ...settings, builtIns: { ...settings.builtIns, [id]: { ...settings.builtIns[id], name: clean } } }
  return { ...settings, presets: settings.presets.map((preset) => preset.id === id ? { ...preset, name: clean } : preset) }
}

/** The player's own is deleted; one of ours is taken off the list («Вернуть стандартные» brings it back). */
export function deletePreset(settings: ScreenTuningSettings, id: string): ScreenTuningSettings {
  const next = isBuiltIn(id)
    ? { ...settings, builtIns: { ...settings.builtIns, [id]: { ...settings.builtIns[id], hidden: true } } }
    : { ...settings, presets: settings.presets.filter((preset) => preset.id !== id) }
  if (next.activeId !== id) return next
  return { ...next, activeId: allPresets(next)[0]?.id ?? BUILT_IN_PRESETS[0]!.id }
}

/** Our presets back on the list under their own names. */
export function restoreBuiltIns(settings: ScreenTuningSettings): ScreenTuningSettings {
  return { ...settings, builtIns: {} }
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
