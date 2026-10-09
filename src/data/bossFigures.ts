/**
 * Boss figures standing in the Overview raid card: which bosses show on which map (the owner's list) and
 * the pre-rendered figure images (src/assets/boss-figures, made by scripts/bosses/render-figures.mjs from
 * the owner's models). A boss without an image yet is simply skipped, so new models can be added one by one.
 */
import figureSizes from '../assets/boss-figures/sizes.json'

const images = import.meta.glob<string>('../assets/boss-figures/*.webp', { eager: true, import: 'default' })
const byKey = new Map(Object.entries(images).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url]))
/** Height of each still in body heights (feet to the top of the head = 1; a raised rifle or antlers add to it). */
const SIZES: Record<string, number> = figureSizes

export interface BossFigure {
  key: string
  name: { ru: string; en: string }
  url: string
  /** Still height in body heights: every still is drawn at the same scale per body, so sizing by this keeps
   * bosses standing together at one real-world scale. */
  height: number
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
  'killa-knight': { ru: 'Древний Килла', en: 'Ancient Killa' },
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
  // Ancient (medieval) versions: Gallery only, never on a map.
  'tagilla-knight': { ru: 'Древний Тагилла', en: 'Ancient Tagilla' },
  'tagilla-2-knight': { ru: 'Древняя Тень Тагиллы', en: 'Ancient Shadow of Tagilla' },
  'reshala-knight': { ru: 'Древний Решала', en: 'Ancient Reshala' },
  'sanitar-knight': { ru: 'Древний Санитар', en: 'Ancient Sanitar' },
  'dark-knight': { ru: 'Древний рыцарь', en: 'Ancient Knight' },
  'zryachiy-archer': { ru: 'Древний Зрячий', en: 'Ancient Zryachiy' },
  'goon-bow': { ru: 'Древний Кочевник (лучник)', en: 'Ancient Goon (archer)' },
  'goon-axe': { ru: 'Древний Кочевник (топор)', en: 'Ancient Goon (axe)' },
  'black-division-old': { ru: 'Древний Black Division', en: 'Ancient Black Division' },
  'ancient-soldier': { ru: 'Древний военный', en: 'Ancient Soldier' },
}

/** Groups that always stand together. */
const GROUPS: Record<string, string[]> = { goons: ['goon-1', 'goon-2', 'goon-3'] }

/**
 * Bosses without a figure of their own that stand as the closest existing one (same still, own name):
 * the Raiders and the RUAF (ВС РФ) as the «Военные» soldiers, Vengeful Killa (Labyrinth) as Killa.
 */
const FIGURE_ALIASES: Record<string, string> = { raiders: 'military', ruaf: 'military', 'killa-vengeful': 'killa' }

type FigureMode = 'pvp' | 'pve' | 'seasonal'
/** A boss that stands on a map only in some modes. */
type ModeEntry = { key: string; modes: FigureMode[] }
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
  'the-lab': ['raiders', seasonOnly('black-division')],
  'the-labyrinth': ['tagilla-2', 'killa-vengeful'],
  // One of the five bosses per raid (~20% each); Black Division and the RUAF (ВС РФ) in every raid (owner, 09.10.2026).
  terminal: ['reshala', 'sanitar', 'killa', 'glukhar', 'tagilla', 'black-division', 'ruaf'],
}

const entryKey = (entry: string | ModeEntry) => (typeof entry === 'string' ? entry : entry.key)
const inMode = (entry: string | ModeEntry, mode?: FigureMode) => typeof entry === 'string' || !mode || entry.modes.includes(mode)

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
    return url ? [{ key, name: BOSS_NAMES[key], url, height: SIZES[key] ?? 1 }] : []
  })
}

/** Map ids where this boss (or its group, or a boss standing as its figure) is shown in any mode, in MAP_BOSSES order. */
export function bossMapIds(key: string): string[] {
  return Object.entries(MAP_BOSSES)
    .filter(([, bosses]) => bosses.map(entryKey).some((entry) => entry === key || GROUPS[entry]?.includes(key) || FIGURE_ALIASES[entry] === key))
    .map(([mapId]) => mapId)
}
