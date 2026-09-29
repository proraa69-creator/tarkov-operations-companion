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
  zryachiy: { ru: 'Зрячий', en: 'Zryachiy' },
  rogue: { ru: 'Отступники', en: 'Rogues' },
  kaban: { ru: 'Кабан', en: 'Kaban' },
  kollontay: { ru: 'Колонтай', en: 'Kollontay' },
  'black-division': { ru: 'Black Division', en: 'Black Division' },
  military: { ru: 'Военные', en: 'Military' },
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

/** Map id → bosses shown there, in display order (left to right). */
const MAP_BOSSES: Record<string, string[]> = {
  customs: ['reshala', 'partisan'],
  woods: ['shturman', 'goons', 'partisan'],
  shoreline: ['sanitar', 'rogue', 'military'],
  interchange: ['killa', 'tagilla'],
  factory: ['tagilla'],
  reserve: ['glukhar', 'rogue'],
  lighthouse: ['zryachiy', 'rogue', 'goons'],
  'streets-of-tarkov': ['kaban', 'kollontay'],
  icebreaker: ['black-division', 'wadge', 'rogue'],
  'the-lab': ['black-division', 'wadge', 'rogue'],
  'the-labyrinth': ['tagilla-2'],
  terminal: ['black-division'],
}

export function bossFiguresFor(mapId: string): BossFigure[] {
  return (MAP_BOSSES[mapId] ?? []).flatMap((key) => GROUPS[key] ?? [key]).flatMap((key) => {
    const url = byKey.get(key)
    return url ? [{ key, name: BOSS_NAMES[key] ?? { ru: key, en: key }, url, height: SIZES[key] ?? 1 }] : []
  })
}

/** Every boss that has a pre-rendered figure, in the owner's list order (the Gallery grid). */
export function allBossFigures(): BossFigure[] {
  return Object.keys(BOSS_NAMES).flatMap((key) => {
    const url = byKey.get(key)
    return url ? [{ key, name: BOSS_NAMES[key], url, height: SIZES[key] ?? 1 }] : []
  })
}

/** Map ids where this boss (or its group) is shown, in MAP_BOSSES order. */
export function bossMapIds(key: string): string[] {
  return Object.entries(MAP_BOSSES)
    .filter(([, bosses]) => bosses.some((entry) => entry === key || GROUPS[entry]?.includes(key)))
    .map(([mapId]) => mapId)
}
