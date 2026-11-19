/**
 * The PC Overview laid out freely (owner, 20.11.2026: «Сделай на пк свободную секцию обзора, все блоки можно перемешать и
 * передвигать как нужно то есть можно подвинуть блок требования рейда наверх а остальные блоки сдвинутся вниз, которые
 * мешают»). A grid of 24 columns; every block keeps its width (its shape, owner 12.10.2026: «Каждый блок не должен менять
 * форму») and can stand at any column and any height: the blocks are laid from the top in their order, each one as high as it
 * goes without covering a block laid before it. A block put above others pushes down the ones it would cover.
 *
 * The cards share the width of the row among them (owner, 17.11.2026: a card taken off, «Распределяются по площади»): four a
 * quarter each, three a third, and so on; a card stands at a multiple of its width.
 *
 * The order and the columns are kept on this computer. A player who never moved a block follows the zones' layout
 * (overviewLayout.ts: their own old order, or the owner's default for everybody), laid out the way it always looked: the cards
 * in a row, the wide column on the left, the narrow one on the right.
 */
import { OVERVIEW_ZONES, type OverviewLayout } from './overviewLayout'

export const GRID = 24
/** Columns a block may start at: every third, so blocks line up with each other and with the cards. */
export const SNAP = 3
/** Below this width (px) the blocks stand in one column, in their order. */
export const SINGLE_BELOW = 820

export interface FreeLayout {
  /** Every block shown, first laid first. */
  order: string[]
  /** The column each block starts at. */
  x: Record<string, number>
  /** Taken off with the cross (owner, 17.11.2026), until «Сбросить». */
  removed?: string[]
}

export const FREE_LAYOUT_KEY = 'raidos-overview-free-v1'

/** All the blocks that can stand on the PC Overview. */
const FREE_BLOCKS: readonly string[] = [...OVERVIEW_ZONES.stats, ...OVERVIEW_ZONES.left, ...OVERVIEW_ZONES.right]

export const isCard = (id: string) => OVERVIEW_ZONES.stats.includes(id)
const cardCount = (order: readonly string[]) => order.filter(isCard).length
/** A card's width when `count` cards are shown. */
const cardWidth = (count: number) => Math.floor(GRID / Math.max(1, Math.min(4, count)))

/** A block's width in columns: a card its share of the row, the left column's blocks 15, the right column's 9 (as before: 1.42 to .88). */
export function widthIn(layout: Pick<FreeLayout, 'order'>, id: string): number {
  if (isCard(id)) return cardWidth(cardCount(layout.order))
  return OVERVIEW_ZONES.right.includes(id) ? 9 : 15
}

/** A column on the grid for a block `w` wide: every third (a card: a multiple of its width), never past the right edge. */
export function snapX(x: number, w: number, card = false): number {
  const step = card ? w : SNAP
  return Math.max(0, Math.min(GRID - w, Math.round(x / step) * step))
}

/** Every block's column snapped for the layout's widths. */
function snapped(order: string[], x: Record<string, number>): Record<string, number> {
  const widths = { order }
  return Object.fromEntries(order.map((id) => [id, snapX(x[id] ?? 0, widthIn(widths, id), isCard(id))]))
}

/** The cards' columns kept in their places when their number changes: the n-th place of the old width is the n-th of the new. */
function rescaleCards(x: Record<string, number>, from: readonly string[], to: readonly string[]): Record<string, number> {
  const before = cardWidth(cardCount(from))
  const after = cardWidth(cardCount(to))
  if (before === after) return x
  return Object.fromEntries(Object.entries(x).map(([id, column]) => [id, isCard(id) ? Math.round(column / before) * after : column]))
}

/**
 * The zones' layout as it always looked: the cards in a row, then the two columns side by side (their blocks taken in turns, so each
 * column keeps its order and both start under the cards).
 */
export function freeFromZones(zones: OverviewLayout): FreeLayout {
  const order: string[] = []
  const x: Record<string, number> = {}
  const card = cardWidth(zones.stats.length)
  zones.stats.forEach((id, at) => { order.push(id); x[id] = at * card })
  for (let at = 0; at < Math.max(zones.left.length, zones.right.length); at += 1) {
    const wide = zones.left[at]
    const narrow = zones.right[at]
    if (wide) { order.push(wide); x[wide] = 0 }
    if (narrow) { order.push(narrow); x[narrow] = GRID - 9 }
  }
  return { order, x: snapped(order, x), ...(zones.removed?.length ? { removed: [...zones.removed] } : {}) }
}

/** A saved layout made safe: known blocks once each, columns on the grid; null when it is not one. */
export function sanitizeFreeLayout(raw: unknown, base: FreeLayout): FreeLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const saved = raw as { order?: unknown; x?: unknown; removed?: unknown }
  if (!Array.isArray(saved.order)) return null
  const known = new Set(FREE_BLOCKS)
  const ids = (list: unknown[]) => [...new Set(list.filter((id): id is string => typeof id === 'string' && known.has(id)))]
  const removed = Array.isArray(saved.removed) ? ids(saved.removed) : []
  const order = ids(saved.order).filter((id) => !removed.includes(id))
  const columns = saved.x && typeof saved.x === 'object' ? saved.x as Record<string, unknown> : {}
  const x: Record<string, number> = {}
  for (const id of order) {
    const value = columns[id]
    x[id] = typeof value === 'number' && Number.isFinite(value) ? value : base.x[id] ?? 0
  }
  return { order, x: snapped(order, x), ...(removed.length ? { removed } : {}) }
}

/**
 * The layout with every block it should show: the owner's hidden ones and those taken off left out, a block it does not have yet
 * (new, or shown again by the owner) joining after the block that comes before it in `base`.
 */
export function completeFree(layout: FreeLayout, hidden: readonly string[], base: FreeLayout): FreeLayout {
  const shown = FREE_BLOCKS.filter((id) => !hidden.includes(id) && !layout.removed?.includes(id))
  const order = layout.order.filter((id) => shown.includes(id))
  const x = { ...layout.x }
  for (const id of [...base.order, ...shown]) {
    if (!shown.includes(id) || order.includes(id)) continue
    const before = base.order.slice(0, Math.max(0, base.order.indexOf(id))).reverse().find((other) => order.includes(other))
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id)
    x[id] = base.x[id] ?? 0
  }
  const kept = rescaleCards(x, layout.order, order)
  return { order, x: snapped(order, kept), ...(layout.removed?.length ? { removed: layout.removed } : {}) }
}

/** The layout without `id`: off the Overview until «Сбросить»; the blocks under it come up, the other cards share its width. */
export function removeFree(layout: FreeLayout, id: string): FreeLayout {
  if (!layout.order.includes(id)) return layout
  const order = layout.order.filter((other) => other !== id)
  return { order, x: snapped(order, rescaleCards(layout.x, layout.order, order)), removed: [...new Set([...(layout.removed ?? []), id])] }
}

export interface FreePlace { id: string; x: number; w: number; y: number; h: number }

/**
 * Where each block stands: laid in order, each at its column as high as it goes under the blocks laid before it that share a column
 * with it. `single`: one column, in order. A block that shows nothing now (no squad) takes no gap.
 */
export function packFree(layout: FreeLayout, heightOf: (id: string) => number, gap: number, single = false): FreePlace[] {
  const first = lay(layout, heightOf, gap, single)
  if (single) return first
  // Cards side by side stand as tall as the tallest of them, as the row of cards always did.
  const tall = new Map<string, number>()
  for (const card of first) {
    if (!isCard(card.id) || card.h <= 0) continue
    tall.set(card.id, Math.max(...first.filter((other) => isCard(other.id) && other.h > 0 && Math.abs(other.y - card.y) < 1).map((other) => other.h)))
  }
  if ([...tall].every(([id, h]) => h === Math.max(0, heightOf(id)))) return first
  return lay(layout, (id) => tall.get(id) ?? heightOf(id), gap, single)
}

function lay(layout: FreeLayout, heightOf: (id: string) => number, gap: number, single: boolean): FreePlace[] {
  const placed: FreePlace[] = []
  for (const id of layout.order) {
    const w = single ? GRID : widthIn(layout, id)
    const x = single ? 0 : snapX(layout.x[id] ?? 0, w, isCard(id))
    const h = Math.max(0, heightOf(id))
    let y = 0
    for (const other of placed) if (other.h > 0 && other.x < x + w && x < other.x + other.w) y = Math.max(y, other.y + other.h + gap)
    placed.push({ id, x, w, y, h })
  }
  return placed
}

/** The height of the whole Overview. */
export const packedHeight = (places: readonly FreePlace[]) => places.reduce((most, place) => Math.max(most, place.y + place.h), 0)

/** `id` laid at `index` of the order and at column `x`; the same object when nothing changes. */
export function moveFree(layout: FreeLayout, id: string, index: number, x: number): FreeLayout {
  const from = layout.order.indexOf(id)
  if (from < 0) return layout
  const to = Math.max(0, Math.min(layout.order.length - 1, index))
  const column = snapX(x, widthIn(layout, id), isCard(id))
  if (to === from && column === layout.x[id]) return layout
  const order = layout.order.filter((other) => other !== id)
  order.splice(to, 0, id)
  return { ...layout, order, x: { ...layout.x, [id]: column } }
}

export const sameFree = (a: FreeLayout, b: FreeLayout) => a.order.join() === b.order.join() && a.order.every((id) => a.x[id] === b.x[id])
  && [...(a.removed ?? [])].sort().join() === [...(b.removed ?? [])].sort().join()

/** The player's own free layout, or null when they never moved a block since the free Overview came. */
export function loadFreeLayout(base: FreeLayout, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): FreeLayout | null {
  try {
    const raw = storage?.getItem(FREE_LAYOUT_KEY)
    return raw ? sanitizeFreeLayout(JSON.parse(raw), base) : null
  } catch {
    return null
  }
}

export function saveFreeLayout(layout: FreeLayout | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage) {
  try {
    if (layout) storage?.setItem(FREE_LAYOUT_KEY, JSON.stringify(layout))
    else storage?.removeItem(FREE_LAYOUT_KEY)
  } catch { /* private mode or a full disk: the layout lives for this session only */ }
}
