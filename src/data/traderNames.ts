/**
 * Trader names when the data has none to show. tarkov.dev keeps a trader's name as a translation key
 * («54cb50c76803fa8b248b4571 Nickname») and the names in the `traders_<lang>` files; a names file without the trader
 * (an older mirror copy, a failed download) used to put the key itself on the screen — the restock bar and
 * notifications showed long strings of letters and digits (owner, 12.10.2026). Shared by the app and the server.
 */
const BUILT_IN: Record<string, string> = {
  prapor: 'Прапор',
  therapist: 'Терапевт',
  fence: 'Скупщик',
  skier: 'Лыжник',
  peacekeeper: 'Миротворец',
  mechanic: 'Механик',
  ragman: 'Барахольщик',
  jaeger: 'Егерь',
  lightkeeper: 'Смотритель',
  taran: 'Таран',
  'radio-station': 'Радиостанция',
  'btr-driver': 'Водитель БТР',
  ref: 'Реф',
  'mr-kerman': 'Мистер Керман',
  voevoda: 'Воевода',
  survivor: 'Выживший',
}

/** A tarkov.dev translation key or a bare id: 24 hex digits, maybe followed by the field («Nickname»). */
const KEY = /^[0-9a-f]{24}(?:\s|$)/i

/** The name to show: the given one unless it is a key, else the built-in name, else the normalized name; '' if none. */
export function traderDisplayName(name: string | undefined, normalizedName?: string) {
  const value = (name ?? '').trim()
  if (value && !KEY.test(value)) return value
  const normalized = (normalizedName ?? '').trim()
  if (BUILT_IN[normalized]) return BUILT_IN[normalized]
  return normalized ? normalized.replace(/[-_]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase()) : ''
}
