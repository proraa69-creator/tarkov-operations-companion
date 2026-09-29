/**
 * Boss figures standing in the Overview raid card: which bosses show on which map (the owner's list) and
 * the pre-rendered figure images (src/assets/boss-figures, made by scripts/bosses/render-figures.mjs from
 * the owner's models). A boss without an image yet is simply skipped, so new models can be added one by one.
 */
const images = import.meta.glob<string>('../assets/boss-figures/*.webp', { eager: true, import: 'default' })
const byKey = new Map(Object.entries(images).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url]))

export interface BossFigure { key: string; name: { ru: string; en: string }; url: string }

const NAMES: Record<string, { ru: string; en: string }> = {
  reshala: { ru: 'Решала', en: 'Reshala' },
  partisan: { ru: 'Партизан', en: 'Partisan' },
  goons: { ru: 'Кочевники', en: 'The Goons' },
  shturman: { ru: 'Штурман', en: 'Shturman' },
  sanitar: { ru: 'Санитар', en: 'Sanitar' },
  killa: { ru: 'Килла', en: 'Killa' },
  tagilla: { ru: 'Тагилла', en: 'Tagilla' },
  'tagilla-2': { ru: 'Тагилла 2', en: 'Tagilla 2' },
  glukhar: { ru: 'Глухарь', en: 'Glukhar' },
  raiders: { ru: 'Рейдеры', en: 'Raiders' },
  zryachiy: { ru: 'Зрячий', en: 'Zryachiy' },
  rogue: { ru: 'Отступники', en: 'Rogues' },
  kaban: { ru: 'Кабан', en: 'Kaban' },
  kollontay: { ru: 'Колонтай', en: 'Kollontay' },
  'black-division': { ru: 'Black Division', en: 'Black Division' },
  military: { ru: 'Военные', en: 'Military' },
}

/** Map id → bosses shown there, in display order (left to right). */
const MAP_BOSSES: Record<string, string[]> = {
  customs: ['reshala', 'partisan'],
  woods: ['shturman', 'goons', 'partisan'],
  shoreline: ['sanitar'],
  interchange: ['killa', 'tagilla'],
  factory: ['killa'],
  reserve: ['glukhar', 'raiders'],
  lighthouse: ['zryachiy', 'rogue', 'goons'],
  'streets-of-tarkov': ['kaban', 'kollontay'],
  icebreaker: ['black-division'],
  'the-lab': ['raiders'],
  'the-labyrinth': ['tagilla-2'],
  terminal: ['black-division', 'military'],
}

export function bossFiguresFor(mapId: string): BossFigure[] {
  return (MAP_BOSSES[mapId] ?? []).flatMap((key) => {
    const url = byKey.get(key)
    return url ? [{ key, name: NAMES[key] ?? { ru: key, en: key }, url }] : []
  })
}
