import type { MapMarker } from '../domain/types'

const files = import.meta.glob<string>('./boss-busts/*.png', { eager: true, import: 'default' })

const busts = new Map(Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.png$/g, ''), url]))

const ALIASES: Record<string, string> = {
  af: 'sentry',
  knight: 'goons',
  'big-pipe': 'goons',
  birdeye: 'goons',
  'unknown-npc': 'rogue',
}

/** Transparent bust icon for a boss marker, keyed by the tarkov.dev portrait file name. */
export function bossBust(marker: MapMarker): string | undefined {
  const portrait = marker.boss?.portraitUrl?.split('/').pop()?.replace(/-portrait\.\w+$/, '')
  for (const key of [portrait, marker.boss?.key]) {
    if (!key) continue
    const bust = busts.get(ALIASES[key] ?? key)
    if (bust) return bust
  }
  return undefined
}
