/**
 * The item key's picture search: the item under the cursor (screenPicture of findItemCell) compared with the icon
 * signature of every catalog item of its size (signatureIndex.ts), at the key press, alongside the tooltip OCR.
 *
 * An item is answered by its picture alone only when its icon is close (PICTURE_INDEX.maxDistance) AND clearly closer
 * than every other picture of that size in the catalog (minMargin) — look-alikes (ammo packs, keys) give no answer
 * here. Their shortlist (`nearby`) still goes to the text: the readings choose among the pictures (see decideByPicture).
 */
import type { ScreenPicture } from './iconMatch.js'
import { signatureDistance, type SignatureDistance } from './iconSignature.js'
import type { IndexedItem, SignatureIndex } from './signatureIndex.js'

export const PICTURE_INDEX = {
  /** The best icon must be at least this close… (same limits as the text candidates' check: PICTURE_MATCH). */
  maxDistance: 0.15,
  /** …and this much closer than the nearest other picture of the catalog. */
  minMargin: 0.08,
  /** Share of the signature that must be visible (cursor, tooltip and labels cover the rest). */
  minKnown: 0.4,
  /** Without an inventory grid found, the cell is a guess: stricter. */
  maxDistanceNoGrid: 0.1,
  /** Pictures this close to the best (within the margin) are handed to the text as the shortlist. */
  nearby: 8,
}

export interface PictureHit { id: string; distance: number; shape: number; tint: number; known: number }

export interface IndexVerdict {
  /** The item, when the picture alone settles it. */
  id: string | null
  reason: 'match' | 'no-index' | 'no-layout' | 'covered' | 'too-far' | 'no-margin'
  /** The closest pictures (best first), for the text to choose among and for the log. */
  nearby: PictureHit[]
  /** Items compared. */
  compared: number
}

/** Index items by size `${cols}x${rows}`, built once per index. */
const bySize = new WeakMap<SignatureIndex, Map<string, IndexedItem[]>>()
function sized(index: SignatureIndex) {
  let map = bySize.get(index)
  if (!map) {
    map = new Map()
    for (const item of index.items) {
      const key = `${item.cols}x${item.rows}`
      const list = map.get(key)
      if (list) list.push(item)
      else map.set(key, [item])
    }
    bySize.set(index, map)
  }
  return map
}

/** Every indexed item of a layout's size (turned too), with its best distance over the layouts. */
export function rankByIndex(screen: ScreenPicture, index: SignatureIndex | null, limits = PICTURE_INDEX): IndexVerdict {
  if (!index?.items.length) return { id: null, reason: 'no-index', nearby: [], compared: 0 }
  const sizes = sized(index)
  const best = new Map<string, SignatureDistance>()
  for (const layout of screen.layouts) {
    const options: Array<[IndexedItem[] | undefined, '0' | '1' | '3']> = [[sizes.get(`${layout.cols}x${layout.rows}`), '0']]
    if (layout.cols !== layout.rows) options.push([sizes.get(`${layout.rows}x${layout.cols}`), '1'], [sizes.get(`${layout.rows}x${layout.cols}`), '3'])
    for (const [items, turn] of options) {
      const signature = layout.turns[turn]
      if (!items || !signature) continue
      for (const item of items) {
        const distance = signatureDistance(signature, item.signature)
        const known = best.get(item.id)
        if (!known || distance.distance < known.distance) best.set(item.id, distance)
      }
    }
  }
  if (!best.size) return { id: null, reason: 'no-layout', nearby: [], compared: 0 }
  const ranked = [...best.entries()].sort((a, b) => a[1].distance - b[1].distance)
  const top = ranked[0]![1]
  const hit = ([id, distance]: [string, SignatureDistance]): PictureHit => ({ id, distance: round(distance.distance), shape: round(distance.shape), tint: round(distance.tint), known: round(distance.known) })
  const nearby = ranked.filter(([, distance], position) => position < limits.nearby && distance.distance - top.distance < limits.minMargin + 0.04).map(hit)
  const verdict = (id: string | null, reason: IndexVerdict['reason']): IndexVerdict => ({ id, reason, nearby, compared: best.size })
  if (top.known < limits.minKnown) return verdict(null, 'covered')
  if (top.distance > (screen.grid ? limits.maxDistance : limits.maxDistanceNoGrid)) return verdict(null, 'too-far')
  const rival = ranked[1]?.[1]
  if (rival && rival.distance - top.distance < limits.minMargin) return verdict(null, 'no-margin')
  return verdict(ranked[0]![0], 'match')
}

const round = (value: number) => Number(value.toFixed(3))
