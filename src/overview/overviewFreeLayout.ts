/**
 * The PC Overview laid out freely (owner, 20.11.2026: «Сделай на пк свободную секцию обзора, все блоки можно перемешать и
 * передвигать как нужно… остальные блоки сдвинутся вниз, которые мешают»). A grid of 24 columns: the blocks are laid from the top in
 * their order, each one as high as it goes without touching a block laid before it, into a gap above them too
 * («Остальные просто сдвигаются выше»).
 *
 * The small cards stand in rows: cards next to each other in the order and of one group are one row; a row moves down or up as one
 * and its cards are as tall as the tallest («кочевники оставались такого же размера, как и остальные блоки. И вставали они рядом»).
 * A row fills its lane: four cards the whole width, three the width of the map's block («крайний блок должен быть по линии вот этого
 * блока»), one or two at the right the right column («чуть-чуть растянуться… выставиться посередине… поджаться, чтобы два блока встало
 * рядом. Как у нас на телефоне»); a single card at the left keeps its own width (nothing stretches far: «Не нужно их растягивать»).
 * A card carried onto a row joins it; carried elsewhere, it is a row of its own. A card taken off leaves the rest of its row to the
 * left, its place empty.
 *
 * Blocks have no size of their own: each takes the room where it stands (owner, 20.11.2026: «ручное изменение блоков убери… блоки
 * сами будут адаптироваться под размер»). The order, the columns and the rows are kept on this computer. A player who
 * never moved a block follows the zones' layout (overviewLayout.ts: their own old order, or the owner's default for everybody).
 */
import { OVERVIEW_ZONES, type OverviewLayout } from './overviewLayout'

export const GRID = 24
/** Columns a block may start at: every third, so blocks line up. */
export const SNAP = 3
/** Below this width (px) the blocks stand in one column, in their order. */
export const SINGLE_BELOW = 820
/** The map's column and the right one (1.42 to .88, as the Overview always was). */
export const WIDE = 15
export const NARROW = GRID - WIDE
const CARD = 6
/** A card of a row stretched further than this stays its own width (a single card at the left). */
const MAX_STRETCH = 1.6
export const MIN_W = 4

export interface FreeLayout {
  /** Every block shown, first laid first. */
  order: string[]
  /** The column a block starts at; a card: its row's column (the first card's). */
  x: Record<string, number>
  /** The row of each card: cards next to each other in the order with one group stand side by side. Absent: 0. */
  group?: Record<string, number>
  /** Taken off with the cross (owner, 17.11.2026), until it is added back or «Сбросить». */
  removed?: string[]
}

export const FREE_LAYOUT_KEY = 'raidos-overview-free-v2'

/** All the blocks that can stand on the PC Overview. */
const FREE_BLOCKS: readonly string[] = [...OVERVIEW_ZONES.stats, ...OVERVIEW_ZONES.left, ...OVERVIEW_ZONES.right]

export const isCard = (id: string) => OVERVIEW_ZONES.stats.includes(id)
export const groupOf = (layout: Pick<FreeLayout, 'group'>, id: string) => layout.group?.[id] ?? 0
export const rowKey = (group: number) => `row:${group}`

/** A block's own width in columns: a card a quarter of the row, the left column's blocks 15, the right column's 9. */
export function widthOf(id: string): number {
  if (isCard(id)) return CARD
  return OVERVIEW_ZONES.right.includes(id) ? NARROW : WIDE
}

export const snapX = (x: number, w: number) => Math.max(0, Math.min(GRID - w, Math.round(x / SNAP) * SNAP))

/** What is laid as one: a block, or a row of cards. */
export interface FreeUnit { key: string; ids: string[]; row: boolean }

export function unitsOf(layout: Pick<FreeLayout, 'order' | 'group'>): FreeUnit[] {
  const units: FreeUnit[] = []
  for (const id of layout.order) {
    const last = units[units.length - 1]
    if (isCard(id) && last?.row && groupOf(layout, last.ids[0]!) === groupOf(layout, id)) { last.ids.push(id); continue }
    units.push(isCard(id) ? { key: rowKey(groupOf(layout, id)), ids: [id], row: true } : { key: id, ids: [id], row: false })
  }
  return units
}

/** Where a unit stands across: its column and width (a row of cards fills its lane). */
export function unitSpan(layout: FreeLayout, unit: FreeUnit, single = false): { x: number; w: number } {
  if (single) return { x: 0, w: GRID }
  const at = layout.x[unit.ids[0]!] ?? 0
  if (!unit.row) {
    // the block takes the column it stands in (owner, 20.11.2026: «оно по стандарту адаптируется под свободное место»)
    return at >= WIDE - 1 ? { x: WIDE, w: NARROW } : { x: 0, w: WIDE }
  }
  const count = unit.ids.length
  if (count >= 4) return { x: 0, w: GRID }
  const right = at >= WIDE - 1
  const lane = right ? (count <= 2 ? { x: WIDE, w: NARROW } : { x: 0, w: GRID }) : { x: 0, w: WIDE }
  // a single card at the left would stretch too far: its own width where it was put
  if (lane.w / count > CARD * MAX_STRETCH) return { x: snapX(at, CARD * count), w: CARD * count }
  return lane
}

/** The cards' rows stay as they were: the zones' layout as it always looked, the cards in a row, then the two columns side by side. */
export function freeFromZones(zones: OverviewLayout): FreeLayout {
  const order: string[] = []
  const x: Record<string, number> = {}
  zones.stats.forEach((id, at) => { order.push(id); x[id] = at * CARD })
  for (let at = 0; at < Math.max(zones.left.length, zones.right.length); at += 1) {
    const wide = zones.left[at]
    const narrow = zones.right[at]
    if (wide) { order.push(wide); x[wide] = 0 }
    if (narrow) { order.push(narrow); x[narrow] = WIDE }
  }
  return { order, x, ...(zones.removed?.length ? { removed: [...zones.removed] } : {}) }
}

/** A saved layout made safe: known blocks once each, columns on the grid; null when it is not one. */
export function sanitizeFreeLayout(raw: unknown, base: FreeLayout): FreeLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const saved = raw as { order?: unknown; x?: unknown; group?: unknown; removed?: unknown }
  if (!Array.isArray(saved.order)) return null
  const known = new Set(FREE_BLOCKS)
  const ids = (list: unknown[]) => [...new Set(list.filter((id): id is string => typeof id === 'string' && known.has(id)))]
  const removed = Array.isArray(saved.removed) ? ids(saved.removed) : []
  const order = ids(saved.order).filter((id) => !removed.includes(id))
  const columns = saved.x && typeof saved.x === 'object' ? saved.x as Record<string, unknown> : {}
  const groups = saved.group && typeof saved.group === 'object' ? saved.group as Record<string, unknown> : {}
  const x: Record<string, number> = {}
  const group: Record<string, number> = {}
  for (const id of order) {
    const value = columns[id]
    x[id] = Math.max(0, Math.min(GRID - MIN_W, typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : base.x[id] ?? 0))
    const row = groups[id]
    if (isCard(id) && typeof row === 'number' && Number.isInteger(row) && row > 0) group[id] = row
  }
  return { order, x, ...(Object.keys(group).length ? { group } : {}), ...(removed.length ? { removed } : {}) }
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
  return tidy({ ...layout, order, x })
}

/** Only what the order holds: columns and groups of the blocks there; nothing empty. */
function tidy(layout: FreeLayout): FreeLayout {
  const order = layout.order
  const x = Object.fromEntries(order.map((id) => [id, layout.x[id] ?? 0]))
  const group = Object.fromEntries(order.filter((id) => isCard(id) && groupOf(layout, id) !== 0).map((id) => [id, groupOf(layout, id)]))
  const removed = layout.removed?.filter((id) => !order.includes(id)) ?? []
  return { order, x, ...(Object.keys(group).length ? { group } : {}), ...(removed.length ? { removed } : {}) }
}

export interface FreePlace { id: string; x: number; w: number; y: number; h: number }

/**
 * Where each block stands: laid unit by unit in order, each at its columns as high as it goes without touching a unit laid before it.
 * A row's cards share its width and are as tall as the tallest. `single`: one column, in order.
 * A block that shows nothing now (no squad) takes no room.
 */
export function packFree(layout: FreeLayout, heightOf: (id: string) => number, gap: number, single = false): FreePlace[] {
  const placed: Array<{ x: number; w: number; y: number; h: number }> = []
  const out: FreePlace[] = []
  for (const unit of unitsOf(layout)) {
    const { x, w } = unitSpan(layout, unit, single)
    const h = Math.max(0, ...unit.ids.map((id) => Math.max(0, heightOf(id))))
    const below = placed.filter((other) => other.h > 0 && other.x < x + w && x < other.x + other.w)
    const free = (top: number) => below.every((other) => !(top < other.y + other.h + gap && other.y < top + h + gap))
    const y = [0, ...below.map((other) => other.y + other.h + gap)].sort((a, b) => a - b).find(free) ?? 0
    placed.push({ x, w, y, h })
    unit.ids.forEach((id, at) => out.push({ id, x: x + (w / unit.ids.length) * at, w: w / unit.ids.length, y, h }))
  }
  return out
}

/** The height of the whole Overview. */
export const packedHeight = (places: readonly FreePlace[]) => places.reduce((most, place) => Math.max(most, place.y + place.h), 0)

const nextGroup = (layout: FreeLayout) => Math.max(0, ...Object.values(layout.group ?? {})) + 1

/**
 * `id` laid at `index` of the order (counted without it) and at column `x`. A card: into the row of `join` (a group), else into a row
 * of its own. The same object when nothing changes.
 */
export function moveFree(layout: FreeLayout, id: string, index: number, x: number, join?: number): FreeLayout {
  const from = layout.order.indexOf(id)
  if (from < 0) return layout
  const order = layout.order.filter((other) => other !== id)
  const to = Math.max(0, Math.min(order.length, index))
  order.splice(to, 0, id)
  const next: FreeLayout = { ...layout, order, x: { ...layout.x } }
  if (isCard(id)) {
    const group = { ...(layout.group ?? {}) }
    if (join !== undefined) {
      if (join === 0) delete group[id]
      else group[id] = join
    } else {
      // a row of its own: its own group unless it stands alone in its row already
      const mates = unitsOf(layout).find((unit) => unit.ids.includes(id))!.ids
      if (mates.length > 1 || unitsOf({ order, group }).find((unit) => unit.ids.includes(id))!.ids.length > 1) group[id] = nextGroup(layout)
    }
    next.group = group
  }
  // the column it was put at: the lane is chosen by it
  const unit = unitsOf(next).find((each) => each.ids.includes(id))!
  if (unit.ids[0] === id) next.x[id] = Math.max(0, Math.min(GRID - MIN_W, Math.round(x)))
  const clean = tidy(next)
  return sameFree(clean, layout) ? layout : clean
}


/**
 * The layout without `id`, off the Overview until it is added back or «Сбросить». A card leaves its row (the rest stays together,
 * at the left); a block's place is left empty and the blocks of its row to its right move left into it (`places`: where the blocks
 * stand now, on the full grid), the ones under it come up by themselves.
 */
export function removeFree(layout: FreeLayout, id: string, places: readonly FreePlace[] = []): FreeLayout {
  if (!layout.order.includes(id)) return layout
  const order = layout.order.filter((other) => other !== id)
  const x = { ...layout.x }
  const gone = places.find((place) => place.id === id)
  if (gone && !isCard(id)) {
    for (const place of places) {
      if (place.id === id || isCard(place.id) || Math.abs(place.y - gone.y) >= 1 || place.x < gone.x + gone.w) continue
      x[place.id] = place.x - gone.w
    }
  }
  // the next card of the row takes the row's column
  if (isCard(id)) {
    const row = unitsOf(layout).find((unit) => unit.ids.includes(id))!
    const heir = row.ids.find((other) => other !== id)
    if (heir && row.ids[0] === id) x[heir] = x[id] ?? 0
  }
  return tidy({ ...layout, order, x, removed: [...new Set([...(layout.removed ?? []), id])] })
}

/** Blocks that can be added: taken off, and not hidden by the owner (owner, 20.11.2026: «добавь функцию добавить блоки»). */
export function addableBlocks(layout: FreeLayout, hidden: readonly string[]): string[] {
  return FREE_BLOCKS.filter((id) => !layout.order.includes(id) && !hidden.includes(id))
}

/**
 * `id` back on the Overview: a card into the first row of cards with room for it (fewer than four); otherwise laid last, at the column
 * where it stands highest, so that it moves none of the others.
 */
export function addFree(layout: FreeLayout, id: string, heightOf: (id: string) => number, gap: number, base: FreeLayout): FreeLayout {
  if (layout.order.includes(id)) return layout
  const removed = (layout.removed ?? []).filter((other) => other !== id)
  const without = { ...layout, ...(removed.length ? { removed } : { removed: undefined }) }
  if (isCard(id)) {
    const row = unitsOf(layout).find((unit) => unit.row && unit.ids.length < 4)
    if (row) {
      const order = [...layout.order]
      order.splice(order.indexOf(row.ids[row.ids.length - 1]!) + 1, 0, id)
      const group = groupOf(layout, row.ids[0]!)
      return tidy({ ...without, order, x: { ...layout.x, [id]: 0 }, group: { ...(layout.group ?? {}), ...(group ? { [id]: group } : {}) } })
    }
  }
  const order = [...layout.order, id]
  const group = isCard(id) ? { ...(layout.group ?? {}), [id]: nextGroup(layout) } : layout.group
  let best: { x: number; y: number } | null = null
  for (let x = 0; x + MIN_W <= GRID; x += SNAP) {
    const trial: FreeLayout = { ...without, order, group, x: { ...layout.x, [id]: x } }
    const place = packFree(trial, heightOf, gap).find((each) => each.id === id)!
    if (Math.abs(place.x - x) > 0.5 && !isCard(id)) continue
    if (!best || place.y < best.y - 0.5) best = { x, y: place.y }
  }
  return tidy({ ...without, order, group, x: { ...layout.x, [id]: best?.x ?? base.x[id] ?? 0 } })
}

export const sameFree = (a: FreeLayout, b: FreeLayout) => JSON.stringify(tidyKeyed(a)) === JSON.stringify(tidyKeyed(b))
const tidyKeyed = (layout: FreeLayout) => {
  const sorted = (record: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  return [layout.order, sorted(layout.x), sorted(layout.group), [...(layout.removed ?? [])].sort()]
}

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
