/**
 * Which bosses stand on which map in the Overview raid card, without the figure images (src/data/bossFigures.ts adds
 * them): shared by the apps and the server, which checks the owner's own lists («Админ панель» → «Блоки» → «Боссы в
 * блоке «План рейда»», src/overview/overviewDefaults.ts `bosses`) against the keys known here.
 */
import { SCOURGE_EVENT_END } from '../events/scourgeEvent'

/** RU/EN display names by boss key (also used by the Gallery). */
export const BOSS_NAMES: Record<string, { ru: string; en: string }> = {
  reshala: { ru: 'Решала', en: 'Reshala' },
  partisan: { ru: 'Партизан', en: 'Partisan' },
  'goon-1': { ru: 'Бёрдай', en: 'Birdeye' },
  'goon-2': { ru: 'Рыцарь', en: 'Knight' },
  'goon-3': { ru: 'Биг Пайп', en: 'Big Pipe' },
  shturman: { ru: 'Штурман', en: 'Shturman' },
  sanitar: { ru: 'Санитар', en: 'Sanitar' },
  killa: { ru: 'Килла', en: 'Killa' },
  tagilla: { ru: 'Тагилла', en: 'Tagilla' },
  'tagilla-2': { ru: 'Тень Тагиллы', en: 'Shadow of Tagilla' },
  'killa-knight': { ru: 'Килла', en: 'Killa' },
  wadge: { ru: 'Wadge', en: 'Wadge' },
  glukhar: { ru: 'Глухарь', en: 'Glukhar' },
  raiders: { ru: 'Рейдеры', en: 'Raiders' },
  'killa-vengeful': { ru: 'Мстительный Килла', en: 'Vengeful Killa' },
  zryachiy: { ru: 'Зрячий', en: 'Zryachiy' },
  'cultist-priest': { ru: 'Жрец', en: 'Cultist Priest' },
  rogue: { ru: 'Отступники', en: 'Rogues' },
  kaban: { ru: 'Кабан', en: 'Kaban' },
  kollontay: { ru: 'Колонтай', en: 'Kollontay' },
  'black-division': { ru: 'Black Division', en: 'Black Division' },
  military: { ru: 'Военные', en: 'Military' },
  ruaf: { ru: 'ВС РФ', en: 'RUAF' },
  scourge: { ru: 'Scourge', en: 'Scourge' },
  // Ancient (medieval) versions: Gallery only, never on a map. Named just by the boss, without «Древний»: the «Древние
  // боссы» tab tells them apart (owner, 12.10.2026).
  'tagilla-knight': { ru: 'Тагилла', en: 'Tagilla' },
  'tagilla-2-knight': { ru: 'Тень Тагиллы', en: 'Shadow of Tagilla' },
  'reshala-knight': { ru: 'Решала', en: 'Reshala' },
  'sanitar-knight': { ru: 'Санитар', en: 'Sanitar' },
  'dark-knight': { ru: 'Рыцарь', en: 'Knight' },
  'zryachiy-archer': { ru: 'Зрячий', en: 'Zryachiy' },
  'goon-bow': { ru: 'Кочевник (лучник)', en: 'Goon (archer)' },
  'goon-axe': { ru: 'Кочевник (топор)', en: 'Goon (axe)' },
  'black-division-old': { ru: 'Black Division', en: 'Black Division' },
  'ancient-soldier': { ru: 'Военный', en: 'Soldier' },
}

/** Groups that always stand together. */
export const BOSS_GROUPS: Record<string, string[]> = { goons: ['goon-1', 'goon-2', 'goon-3'] }

/**
 * Bosses without a figure of their own that stand as the closest existing one (same still, own name):
 * the RUAF (ВС РФ) as the «Военные» soldiers, Vengeful Killa (Labyrinth) as Killa. The Raiders have their own model
 * (owner, 11.10.2026: «рейдера в боссы»).
 */
export const FIGURE_ALIASES: Record<string, string> = { ruaf: 'military', 'killa-vengeful': 'killa' }

export const FIGURE_MODES = ['pvp', 'pve', 'seasonal'] as const
export type FigureMode = (typeof FIGURE_MODES)[number]
/** A boss that stands on a map only in some modes, or (`until`, ms) only until an event ends. */
export interface MapBossEntry { key: string; modes: FigureMode[]; until?: number }
const seasonOnly = (key: string): MapBossEntry => ({ key, modes: ['seasonal'] })

/**
 * Map id → bosses shown there, in display order (left to right), from the owner's research list «Боссы по картам»
 * (30.09.2026, scratchpad research/bosses-by-map.md). Every boss the list gives for a map, in the modes it gives
 * (Black Division patrols on Shoreline / Streets / Ground Zero only in Season). The Cultist Priest (owner's model of
 * 19.10.2026) stands on his night maps: Customs, Woods, Shoreline, Factory (night) and Ground Zero (21+). Skipped:
 * unconfirmed Rogues on Shoreline (one source), Glukhar on Lighthouse (gone). The owner's own lists replace a map's.
 */
export const BUILT_IN_MAP_BOSSES: Readonly<Record<string, ReadonlyArray<string | MapBossEntry>>> = {
  customs: ['reshala', 'goons', 'partisan', 'cultist-priest'],
  woods: ['shturman', 'goons', 'partisan', 'cultist-priest'],
  shoreline: ['sanitar', 'goons', 'partisan', 'cultist-priest', seasonOnly('black-division')],
  interchange: ['killa', 'tagilla'],
  factory: ['tagilla', 'cultist-priest'],
  reserve: ['glukhar', 'raiders'],
  lighthouse: ['zryachiy', 'rogue', 'goons', 'partisan'],
  'streets-of-tarkov': ['kaban', 'kollontay', seasonOnly('black-division')],
  'ground-zero': ['cultist-priest', seasonOnly('black-division')],
  icebreaker: ['wadge', 'black-division', 'goons', 'rogue'],
  // «Вторжение Scourge»: in every raid in every mode until the event ends (owner, 16.10.2026)
  'the-lab': [{ key: 'scourge', modes: ['pvp', 'pve', 'seasonal'], until: SCOURGE_EVENT_END }, 'raiders', seasonOnly('black-division')],
  'the-labyrinth': ['tagilla-2', 'killa-vengeful'],
  // One of the five bosses per raid (~20% each); Black Division and the RUAF (ВС РФ) in every raid (owner, 09.10.2026).
  terminal: ['reshala', 'sanitar', 'killa', 'glukhar', 'tagilla', 'black-division', 'ruaf'],
}

/** The maps of the raid card, in the order above. */
export const BOSS_MAP_IDS: readonly string[] = Object.keys(BUILT_IN_MAP_BOSSES)

/** Who can stand on a map (the owner's list picks from these): every boss but the Gallery-only ancient ones and the Goons one by one. */
export const MAP_BOSS_KEYS: readonly string[] = [
  'reshala', 'shturman', 'sanitar', 'killa', 'tagilla', 'glukhar', 'zryachiy', 'kaban', 'kollontay', 'partisan', 'goons',
  'cultist-priest', 'rogue', 'raiders', 'black-division', 'wadge', 'tagilla-2', 'killa-vengeful', 'scourge', 'military', 'ruaf',
]
const MAP_BOSS_KEY_SET: ReadonlySet<string> = new Set(MAP_BOSS_KEYS)

/** The name of a map boss (the Goons as one). */
export const mapBossName = (key: string) => (key === 'goons' ? { ru: 'Кочевники', en: 'The Goons' } : BOSS_NAMES[key] ?? { ru: key, en: key })

export const asMapBossEntry = (entry: string | MapBossEntry): MapBossEntry => (typeof entry === 'string' ? { key: entry, modes: [...FIGURE_MODES] } : { ...entry, modes: [...entry.modes] })

/** A map's bosses: the owner's list when there is one, else the built-in. */
export function mapBossEntries(mapId: string, own?: Readonly<Record<string, readonly MapBossEntry[]>> | null): ReadonlyArray<string | MapBossEntry> {
  return own?.[mapId] ?? BUILT_IN_MAP_BOSSES[mapId] ?? []
}

/** The owner's lists made safe: known maps and bosses, each boss once, at least one mode; null for anything else. */
export function sanitizeMapBosses(raw: unknown): Record<string, MapBossEntry[]> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const lists: Record<string, MapBossEntry[]> = {}
  for (const [mapId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!(mapId in BUILT_IN_MAP_BOSSES) || !Array.isArray(list)) continue
    const seen = new Set<string>()
    const entries: MapBossEntry[] = []
    for (const item of list.slice(0, MAP_BOSS_KEYS.length)) {
      if (!item || typeof item !== 'object') continue
      const { key, modes, until } = item as Record<string, unknown>
      if (typeof key !== 'string' || !MAP_BOSS_KEY_SET.has(key) || seen.has(key)) continue
      const own = Array.isArray(modes) ? FIGURE_MODES.filter((mode) => modes.includes(mode)) : []
      if (!own.length) continue
      seen.add(key)
      entries.push({ key, modes: own, ...(typeof until === 'number' && Number.isFinite(until) ? { until } : {}) })
    }
    lists[mapId] = entries
  }
  return lists
}
