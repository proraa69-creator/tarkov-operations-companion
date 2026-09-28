/** Fandom Interactive Map pages from https://escapefromtarkov.fandom.com/ru/wiki/Карта:Берег */

export const wikiMapNames: Record<string, string> = {
  customs: 'Таможня',
  factory: 'Завод',
  'ground-zero': 'Эпицентр',
  interchange: 'Развязка',
  lighthouse: 'Маяк',
  reserve: 'Резерв',
  'streets-of-tarkov': 'Улицы Таркова',
  'the-lab': 'Лаборатория',
  woods: 'Лес',
  shoreline: 'Берег',
  'the-labyrinth': 'Лабиринт',
  labyrinth: 'Лабиринт',
  terminal: 'Терминал',
  icebreaker: 'Ледокол',
}

const WIKI_ORIGIN = 'https://escapefromtarkov.fandom.com'

export function wikiMapPageTitle(id: string) {
  const name = wikiMapNames[id]
  return name ? `Карта:${name}` : undefined
}

export function wikiMapUrl(id: string, markerId = '') {
  const title = wikiMapPageTitle(id)
  if (!title) return undefined
  const url = `${WIKI_ORIGIN}/ru/wiki/${encodeURIComponent(title)}`
  return markerId ? `${url}?marker=${encodeURIComponent(markerId)}` : url
}

export function isWikiMapHost(url: string) {
  try {
    const { hostname } = new URL(url)
    return hostname === 'escapefromtarkov.fandom.com'
      || hostname.endsWith('.fandom.com')
      || hostname.endsWith('.wikia.nocookie.net')
      || hostname === 'static.wikia.nocookie.net'
  } catch {
    return false
  }
}
