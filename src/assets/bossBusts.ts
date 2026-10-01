import type { BossInfo, MapMarker } from '../domain/types'

const files = import.meta.glob<string>('./boss-busts/*.png', { eager: true, import: 'default' })

const busts = new Map(Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.png$/g, ''), url]))

/** tarkov.dev mob names / ids and our own keys that have no bust file of the same name. */
const ALIASES: Record<string, string> = {
  af: 'sentry',
  knight: 'goons',
  'big-pipe': 'goons',
  birdeye: 'goons',
  // Our research supplement and the boss gallery call the Black Division boss marker «black-division».
  'black-division': 'black-div-boss',
  'black-division-boss': 'black-div-boss',
  blackdivision: 'black-div',
  bossbullyblackdiv: 'black-div-boss',
  pmcbotblackdiv: 'black-div-raider',
  // The Wedge is «Wadge» in the boss gallery and «Клин» in the Russian client.
  wadge: 'the-wedge',
  wedge: 'the-wedge',
  klin: 'the-wedge',
  bosswedge: 'the-wedge',
  'wadge-labs': 'the-wedge-labs',
  'the-wedge-lab': 'the-wedge-labs',
}

/** Last resort for names the feed may use (localized or renamed): matched against the boss name / marker title. */
const NAME_PATTERNS: Array<[RegExp, string]> = [
  [/(wedge|wadge|клин).*(lab|лаб)/i, 'the-wedge-labs'],
  [/wedge|wadge|клин/i, 'the-wedge'],
  [/black.?div.*raider|black.?div.*рейдер/i, 'black-div-raider'],
  [/black.?div/i, 'black-div-boss'],
]

/** tarkov.dev serves this generic silhouette for mobs that have no portrait of their own. */
const GENERIC_PORTRAIT = 'unknown-npc'

function portraitKey(url?: string) {
  return url?.split('/').pop()?.replace(/-portrait\.\w+$/, '')
}

function lookup(key?: string) {
  if (!key) return undefined
  const normalized = key.trim().toLowerCase()
  return busts.get(ALIASES[normalized] ?? normalized)
}

/** Transparent bust for a boss, keyed by the tarkov.dev portrait file name, the boss key, or (last) its name. */
export function bossBustFor(boss: Pick<BossInfo, 'key' | 'name' | 'portraitUrl'> | undefined, title?: string): string | undefined {
  const portrait = portraitKey(boss?.portraitUrl)
  for (const key of [portrait === GENERIC_PORTRAIT ? undefined : portrait, boss?.key]) {
    const bust = lookup(key)
    if (bust) return bust
  }
  for (const name of [boss?.name, title]) {
    const match = name ? NAME_PATTERNS.find(([pattern]) => pattern.test(name)) : undefined
    if (match) return busts.get(match[1])
  }
  // A mob tarkov.dev has no portrait for (unknown-npc) was shown with the Rogue bust before.
  return portrait === GENERIC_PORTRAIT ? busts.get('rogue') : undefined
}

/** Transparent bust icon for a boss marker. */
export function bossBust(marker: MapMarker): string | undefined {
  return bossBustFor(marker.boss, marker.title)
}

/** True when the URL is tarkov.dev's generic «unknown NPC» silhouette rather than a real portrait. */
export function isGenericPortrait(url?: string) {
  return portraitKey(url) === GENERIC_PORTRAIT
}
