/**
 * Boss figures standing in the Overview raid card: which bosses show on which map (the owner's list) and
 * the pre-rendered figure images (src/assets/boss-figures, made by scripts/bosses/render-figures.mjs from
 * the owner's models). A boss without an image yet is simply skipped, so new models can be added one by one.
 */
import figureFrames from '../assets/boss-figures/frames.json'
import figureSizes from '../assets/boss-figures/sizes.json'
import { SCOURGE_EVENT_END } from '../events/scourgeEvent'

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
const GROUPS: Record<string, string[]> = { goons: ['goon-1', 'goon-2', 'goon-3'] }

/**
 * Bosses without a figure of their own that stand as the closest existing one (same still, own name):
 * the RUAF (ВС РФ) as the «Военные» soldiers, Vengeful Killa (Labyrinth) as Killa. The Raiders have their own model
 * (owner, 11.10.2026: «рейдера в боссы»).
 */
const FIGURE_ALIASES: Record<string, string> = { ruaf: 'military', 'killa-vengeful': 'killa' }

type FigureMode = 'pvp' | 'pve' | 'seasonal'
/** A boss that stands on a map only in some modes, or (`until`, ms) only until an event ends. */
type ModeEntry = { key: string; modes: FigureMode[]; until?: number }
const seasonOnly = (key: string): ModeEntry => ({ key, modes: ['seasonal'] })

/**
 * Map id → bosses shown there, in display order (left to right), from the owner's research list «Боссы по картам»
 * (30.09.2026, scratchpad research/bosses-by-map.md). Every boss the list gives for a map, in the modes it gives
 * (Black Division patrols on Shoreline / Streets / Ground Zero only in Season). Skipped: the Cultist Priest and
 * the Ground Zero cultists (no figure yet), unconfirmed Rogues on Shoreline (one source), Glukhar on Lighthouse (gone).
 */
const MAP_BOSSES: Record<string, Array<string | ModeEntry>> = {
  customs: ['reshala', 'goons', 'partisan'],
  woods: ['shturman', 'goons', 'partisan'],
  shoreline: ['sanitar', 'goons', 'partisan', seasonOnly('black-division')],
  interchange: ['killa', 'tagilla'],
  factory: ['tagilla'],
  reserve: ['glukhar', 'raiders'],
  lighthouse: ['zryachiy', 'rogue', 'goons', 'partisan'],
  'streets-of-tarkov': ['kaban', 'kollontay', seasonOnly('black-division')],
  'ground-zero': [seasonOnly('black-division')],
  icebreaker: ['wadge', 'black-division', 'goons', 'rogue'],
  // «Вторжение Scourge»: in every raid in every mode until the event ends (owner, 16.10.2026)
  'the-lab': [{ key: 'scourge', modes: ['pvp', 'pve', 'seasonal'], until: SCOURGE_EVENT_END }, 'raiders', seasonOnly('black-division')],
  'the-labyrinth': ['tagilla-2', 'killa-vengeful'],
  // One of the five bosses per raid (~20% each); Black Division and the RUAF (ВС РФ) in every raid (owner, 09.10.2026).
  terminal: ['reshala', 'sanitar', 'killa', 'glukhar', 'tagilla', 'black-division', 'ruaf'],
}

const entryKey = (entry: string | ModeEntry) => (typeof entry === 'string' ? entry : entry.key)
const inMode = (entry: string | ModeEntry, mode?: FigureMode, now = Date.now()) => typeof entry === 'string' || ((entry.until === undefined || now < entry.until) && (!mode || entry.modes.includes(mode)))

function figure(key: string): BossFigure | undefined {
  const still = FIGURE_ALIASES[key] ?? key
  const url = byKey.get(still)
  return url ? { key, name: BOSS_NAMES[key] ?? { ru: key, en: key }, url, height: SIZES[still] ?? 1 } : undefined
}

/** Figures of the map for the game mode (without a mode: every boss of the map in any mode). */
export function bossFiguresFor(mapId: string, mode?: FigureMode): BossFigure[] {
  return (MAP_BOSSES[mapId] ?? []).filter((entry) => inMode(entry, mode)).map(entryKey)
    .flatMap((key) => GROUPS[key] ?? [key]).flatMap((key) => figure(key) ?? [])
}

/** Every boss that has a pre-rendered figure, in the owner's list order (the Gallery grid). */
export function allBossFigures(): BossFigure[] {
  return Object.keys(BOSS_NAMES).flatMap((key) => {
    const url = byKey.get(key)
    return url ? [{ key, name: BOSS_NAMES[key], url, height: SIZES[key] ?? 1, ...(FRAMES[key] ? { frame: FRAMES[key] } : {}) }] : []
  })
}

/** Map ids where this boss (or its group, or a boss standing as its figure) is shown in any mode, in MAP_BOSSES order. */
export function bossMapIds(key: string): string[] {
  return Object.entries(MAP_BOSSES)
    .filter(([, bosses]) => bosses.map(entryKey).some((entry) => entry === key || GROUPS[entry]?.includes(key) || FIGURE_ALIASES[entry] === key))
    .map(([mapId]) => mapId)
}
