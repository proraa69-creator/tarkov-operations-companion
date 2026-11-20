/**
 * «Модули убежища» of the owner's «Админ панель» (owner, 20.11.2026: «подготовь для ПВП сезонного режима… спортзал, биткоин-ферма
 * будет сразу со старта… Добавь в игру сразу эту функцию. Включение любого модуля и выключение… оно сразу же без обновления
 * приложения появится»): per mode, the hideout modules the owner opens from the start or turns off, for every player —
 * - `open`: there from the start: its button shows even behind the defective wall not broken yet, and no other module (the wall,
 *   the generator, …) stands in the way of any of its levels; the items its levels take are still wanted;
 * - `hidden`: not in that mode's hideout at all: no button, no piece of the picture, not counted in «Что собрать» or the other
 *   lists, its crafts not offered.
 * A module in neither list is as the game's data has it; nothing set (the default) leaves every mode as before.
 *
 * Shared by the server (server/src/routes/hideoutModules.ts validates and keeps it) and the apps
 * (src/hideout/hideoutModulesStore.ts, read with the owner's notice at GET /v1/announcement `hideoutModules`).
 */
import type { HideoutStation, RaidMode } from '../domain/types'

export const HIDEOUT_MODULE_MODES: readonly RaidMode[] = ['pvp', 'pve', 'seasonal']

export interface ModeModules { open: string[]; hidden: string[] }

export interface HideoutModules {
  modes: Partial<Record<RaidMode, ModeModules>>
  updatedAt?: string
}

/** The game's area template ids (the same as tarkov.dev's station ids). */
export const HIDEOUT_MODULE_ID = /^[a-f0-9]{24}$/
export const GYM = '6377a9b9a93bde8fa30eb79a'
export const BITCOIN_FARM = '5d494a445b56502f18c98a10'
export const CULTIST_CIRCLE = '667298e75ea6b4493c08f266'

/**
 * Every module of the game's hideout, by tarkov.dev's normalizedName (json.tarkov.dev regular and pvp-season hideout, 20.11.2026:
 * the same 26 in both). The server accepts these and the ones of its catalog, so a module a new season brings needs no new app.
 */
export const HIDEOUT_MODULES: ReadonlyArray<{ id: string; name: string }> = [
  { id: '5d388e97081959000a123acf', name: 'heating' },
  { id: '5d3b396e33c48f02b81cd9f3', name: 'generator' },
  { id: '5d473c1e081959000e530190', name: 'vents' },
  { id: '5d484fb3654e7600681d9314', name: 'security' },
  { id: '5d484fba654e7600691aadf7', name: 'lavatory' },
  { id: '5d484fc0654e76006657e0ab', name: 'stash' },
  { id: '5d484fc8654e760065037abf', name: 'water-collector' },
  { id: '5d484fcd654e7668ec2ec322', name: 'medstation' },
  { id: '5d484fd1654e76006732bf2e', name: 'nutrition-unit' },
  { id: '5d484fd6654e76051d3cc791', name: 'rest-space' },
  { id: '5d484fda654e7600681d9315', name: 'workbench' },
  { id: '5d484fdf654e7600691aadf8', name: 'intelligence-center' },
  { id: '5d484fe3654e76006657e0ac', name: 'shooting-range' },
  { id: '5d494a0e5b56502f18c98a02', name: 'library' },
  { id: '5d494a175b56502f18c98a04', name: 'scav-case' },
  { id: '5d494a205b56502f18c98a06', name: 'illumination' },
  { id: '5d494a295b56502f18c98a08', name: 'hall-of-fame' },
  { id: '5d494a315b56502f18c98a0a', name: 'air-filtering-unit' },
  { id: '5d494a385b56502f18c98a0c', name: 'solar-power' },
  { id: '5d494a3f5b56502f18c98a0e', name: 'booze-generator' },
  { id: BITCOIN_FARM, name: 'bitcoin-farm' },
  { id: GYM, name: 'gym' },
  { id: '637b39f02e873739ec490215', name: 'defective-wall' },
  { id: '63db64cbf9963741dc0d741f', name: 'weapon-rack' },
  { id: '65e5bb1713227bb7690cea0a', name: 'gear-rack' },
  { id: CULTIST_CIRCLE, name: 'cultist-circle' },
]

export const KNOWN_HIDEOUT_MODULES: ReadonlySet<string> = new Set(HIDEOUT_MODULES.map((module) => module.id))

/** At most this many ids in one list (the game has 26 modules). */
export const MODULES_MAX = 64

/** Ids of `raw` that look like modules, once each. */
const moduleIds = (raw: unknown) => (Array.isArray(raw)
  ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && HIDEOUT_MODULE_ID.test(id)))].slice(0, MODULES_MAX)
  : [])

/** One mode's lists made safe (a module both open and turned off stays off); null when both are empty. */
export function sanitizeModeModules(raw: unknown): ModeModules | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as { open?: unknown; hidden?: unknown }
  const hidden = moduleIds(value.hidden)
  const open = moduleIds(value.open).filter((id) => !hidden.includes(id))
  return open.length || hidden.length ? { open, hidden } : null
}

/** The stored or received setting made safe; null for none (every mode as in the game). */
export function sanitizeHideoutModules(raw: unknown): HideoutModules | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as { modes?: unknown; updatedAt?: unknown }
  const source = value.modes && typeof value.modes === 'object' && !Array.isArray(value.modes) ? value.modes as Record<string, unknown> : {}
  const modes: HideoutModules['modes'] = {}
  for (const mode of HIDEOUT_MODULE_MODES) {
    const lists = sanitizeModeModules(source[mode])
    if (lists) modes[mode] = lists
  }
  if (!Object.keys(modes).length) return null
  return { modes, ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}) }
}

export interface ModeModuleSets { open: ReadonlySet<string>; hidden: ReadonlySet<string> }

const NONE: ModeModuleSets = { open: new Set(), hidden: new Set() }

/** The modules open from the start and turned off in a mode. */
export function modeModules(setting: HideoutModules | null | undefined, mode: RaidMode): ModeModuleSets {
  const lists = setting?.modes[mode]
  return lists ? { open: new Set(lists.open), hidden: new Set(lists.hidden) } : NONE
}

/** A module there from the start: no level waits for another module (its own previous level still comes first). */
function openFromStart(station: HideoutStation): HideoutStation {
  if (!station.levels?.some((level) => level.stationRequirements?.length)) return station
  const first = new Set(station.levels.find((level) => level.level === 1)?.stationRequirements ?? [])
  return {
    ...station,
    requirements: station.requirements.filter((line) => !first.has(line)),
    levels: station.levels.map((level) => (level.stationRequirements?.length ? { ...level, stationRequirements: [] } : level)),
  }
}

/**
 * The hideout of a mode as the owner set it: the modules turned off gone, the open ones without other modules' requirements. The
 * same list (not a copy) when the owner set nothing for the mode.
 */
export function applyHideoutModules(stations: HideoutStation[], mode: RaidMode, setting: HideoutModules | null | undefined): HideoutStation[] {
  const { open, hidden } = modeModules(setting, mode)
  if (!open.size && !hidden.size) return stations
  return stations.filter((station) => !hidden.has(station.id)).map((station) => (open.has(station.id) ? openFromStart(station) : station))
}
