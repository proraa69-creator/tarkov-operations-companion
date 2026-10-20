/**
 * Boss figures standing in the Overview raid card: which bosses show on which map (src/data/bossRoster.ts — built in,
 * or the owner's own list from «Админ панель» → «Блоки») and the pre-rendered figure images (src/assets/boss-figures, made by scripts/bosses/render-figures.mjs from
 * the owner's models). A boss without an image yet is simply skipped, so new models can be added one by one.
 */
import figureFrames from '../assets/boss-figures/frames.json'
import figureSizes from '../assets/boss-figures/sizes.json'
import { BOSS_GROUPS, BOSS_MAP_IDS, BOSS_NAMES, FIGURE_ALIASES, mapBossEntries, type FigureMode, type MapBossEntry } from './bossRoster'

export { BOSS_NAMES } from './bossRoster'

const images = import.meta.glob<string>('../assets/boss-figures/*.webp', { eager: true, import: 'default' })
const byKey = new Map(Object.entries(images).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url]))
/** Height of each still in body heights (feet to the top of the head = 1; a raised rifle or antlers add to it). */
const SIZES: Record<string, number> = figureSizes
/** Where each still sits in the Gallery viewer's start view: [left of its centre, top, width, height] in view heights. */
const FRAMES: Record<string, StillFrame> = Object.fromEntries(Object.entries(figureFrames as Record<string, number[]>)
  .flatMap(([key, frame]) => (frame.length === 4 && frame.every(Number.isFinite) ? [[key, [frame[0]!, frame[1]!, frame[2]!, frame[3]!] as const]] : [])))

export type StillFrame = readonly [left: number, top: number, width: number, height: number]

export interface BossFigure {
  key: string
  name: { ru: string; en: string }
  url: string
  /** Still height in body heights: every still is drawn at the same scale per body, so sizing by this keeps
   * bosses standing together at one real-world scale. */
  height: number
  /** Where the still stands in the Gallery viewer's start view (scripts/bosses/render-figures.mjs --frames). */
  frame?: StillFrame
}

type OwnLists = Readonly<Record<string, readonly MapBossEntry[]>> | null | undefined

const entryKey = (entry: string | MapBossEntry) => (typeof entry === 'string' ? entry : entry.key)
const inMode = (entry: string | MapBossEntry, mode?: FigureMode, now = Date.now()) => typeof entry === 'string' || ((entry.until === undefined || now < entry.until) && (!mode || entry.modes.includes(mode)))

function figure(key: string): BossFigure | undefined {
  const still = FIGURE_ALIASES[key] ?? key
  const url = byKey.get(still)
  return url ? { key, name: BOSS_NAMES[key] ?? { ru: key, en: key }, url, height: SIZES[still] ?? 1 } : undefined
}

/**
 * Figures of the map for the game mode (without a mode: every boss of the map in any mode). `own`: the owner's lists
 * («Админ панель» → «Блоки», src/overview/overviewDefaults.ts `bosses`) replace the built-in list of their maps.
 */
export function bossFiguresFor(mapId: string, mode?: FigureMode, own?: OwnLists): BossFigure[] {
  return mapBossEntries(mapId, own).filter((entry) => inMode(entry, mode)).map(entryKey)
    .flatMap((key) => BOSS_GROUPS[key] ?? [key]).flatMap((key) => figure(key) ?? [])
}

/** Every boss that has a pre-rendered figure, in the owner's list order (the Gallery grid). */
export function allBossFigures(): BossFigure[] {
  return Object.keys(BOSS_NAMES).flatMap((key) => {
    const url = byKey.get(key)
    return url ? [{ key, name: BOSS_NAMES[key], url, height: SIZES[key] ?? 1, ...(FRAMES[key] ? { frame: FRAMES[key] } : {}) }] : []
  })
}

/** Map ids where this boss (or its group, or a boss standing as its figure) is shown in any mode, in the maps' order. */
export function bossMapIds(key: string, own?: OwnLists): string[] {
  return BOSS_MAP_IDS
    .filter((mapId) => mapBossEntries(mapId, own).map(entryKey).some((entry) => entry === key || BOSS_GROUPS[entry]?.includes(key) || FIGURE_ALIASES[entry] === key))
}
