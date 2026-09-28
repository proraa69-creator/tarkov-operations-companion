/** Canonical companion map ids and Russian labels used across catalog, maps and transits. */

export const MAP_DISPLAY_NAMES: Record<string, string> = {
  customs: 'Таможня',
  factory: 'Завод',
  woods: 'Лес',
  shoreline: 'Берег',
  interchange: 'Развязка',
  reserve: 'Резерв',
  lighthouse: 'Маяк',
  'streets-of-tarkov': 'Улицы Таркова',
  'the-lab': 'Лаборатория',
  'the-labyrinth': 'Лабиринт',
  'ground-zero': 'Эпицентр',
  terminal: 'Терминал',
  icebreaker: 'Ледокол',
}

const MAP_ID_ALIASES: Record<string, string> = {
  'night-factory': 'factory',
  'factory-night': 'factory',
  factory4: 'factory',
  factory4_night: 'factory',
  bigmap: 'customs',
  rezervbase: 'reserve',
  rezerv: 'reserve',
  laboratory: 'the-lab',
  labs: 'the-lab',
  'the-lab-dark': 'the-lab',
  'laboratory-dark': 'the-lab',
  labyrinth: 'the-labyrinth',
  tarkovstreets: 'streets-of-tarkov',
  streets: 'streets-of-tarkov',
  'ground-zero-21': 'ground-zero',
  'ground-zero-tutorial': 'ground-zero',
  sandbox: 'ground-zero',
  sandbox_high: 'ground-zero',
}

export function canonicalMapId(value: string) {
  const key = value.trim().toLowerCase()
  if (!key) return ''
  if (key.startsWith('ground-zero')) return 'ground-zero'
  return MAP_ID_ALIASES[key] ?? key
}

export function mapDisplayName(id: string, maps: Array<{ id: string; name: string }> = []) {
  const canonical = canonicalMapId(id)
  return maps.find((map) => map.id === canonical)?.name
    ?? MAP_DISPLAY_NAMES[canonical]
    ?? MAP_DISPLAY_NAMES[id]
    ?? id
}

export function localizeMapCopy(value: string) {
  return value
    .replace(/\bPMC\b/gi, 'ЧВК')
    .replace(/\bSCAVS?\b/gi, 'Диких')
    .replace(/\bScavs?\b/g, 'Диких')
    .replace(/\bTransit(s)?\b/gi, 'Переход')
    .replace(/\bCo-?op\b/gi, 'Совместный')
}
