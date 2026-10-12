/**
 * «Настроить блоки» on the Overview (owner, 12.10.2026: «добавь функцию перемещение блоков на вкладке обзор, кроме
 * большой карты… Каждый блок не должен менять форму но можно переносить по вкладке обзор»). A block moves only among
 * the places of its own shape, so it never changes size:
 * - stats: the four small cards of the top row;
 * - rows: the full-width rows — the map priority strip stands above the cards, under them or at the very bottom;
 * - left: the wide column under the big raid map (the map itself never moves);
 * - right: the narrow column.
 * The order is kept on this computer (localStorage). Unknown ids are dropped, and blocks added later join at their
 * default place.
 */
export type OverviewZoneId = 'stats' | 'rows' | 'left' | 'right'

export type OverviewLayout = Record<OverviewZoneId, string[]>

export const OVERVIEW_ZONES: Readonly<Record<OverviewZoneId, readonly string[]>> = {
  stats: ['stat-tasks', 'stat-progress', 'stat-kappa', 'stat-goons'],
  rows: ['stats', 'priority', 'columns'],
  left: ['squad', 'requirements'],
  right: ['tasks', 'gunsmith', 'favorites'],
}

/** Rows that are not dragged themselves: the card row (its cards move) and the columns with the big map. */
export const FIXED_BLOCKS: ReadonlySet<string> = new Set(['stats', 'columns'])

export const OVERVIEW_LAYOUT_KEY = 'raidos-overview-layout-v1'

const ZONE_IDS = Object.keys(OVERVIEW_ZONES) as OverviewZoneId[]

export function defaultOverviewLayout(): OverviewLayout {
  return Object.fromEntries(ZONE_IDS.map((zone) => [zone, [...OVERVIEW_ZONES[zone]]])) as OverviewLayout
}

/** A saved layout made safe: each zone holds exactly its own blocks, once each; anything else is dropped. */
export function sanitizeOverviewLayout(raw: unknown): OverviewLayout {
  const saved = raw && typeof raw === 'object' ? raw as Partial<Record<OverviewZoneId, unknown>> : {}
  const layout = defaultOverviewLayout()
  for (const zone of ZONE_IDS) {
    const known = OVERVIEW_ZONES[zone]
    const list = Array.isArray(saved[zone]) ? (saved[zone] as unknown[]).filter((id): id is string => typeof id === 'string' && known.includes(id)) : []
    const order = [...new Set(list)]
    // New blocks (not in the saved order yet) take their default place.
    for (const id of known) if (!order.includes(id)) order.splice(Math.min(known.indexOf(id), order.length), 0, id)
    layout[zone] = order
  }
  // The card row always stays above the columns with the big map; only the strip moves around them.
  const rows = layout.rows.filter((id) => !FIXED_BLOCKS.has(id))
  const fixed = OVERVIEW_ZONES.rows.filter((id) => FIXED_BLOCKS.has(id))
  const strip = layout.rows.indexOf('priority')
  const fixedBefore = layout.rows.slice(0, strip).filter((id) => FIXED_BLOCKS.has(id)).length
  layout.rows = [...fixed.slice(0, fixedBefore), ...rows, ...fixed.slice(fixedBefore)]
  return layout
}

/** The layout with `id` moved to `toIndex` of its zone (clamped); the same object when nothing changes. */
export function moveBlock(layout: OverviewLayout, zone: OverviewZoneId, id: string, toIndex: number): OverviewLayout {
  const order = layout[zone]
  const from = order.indexOf(id)
  if (from < 0 || FIXED_BLOCKS.has(id)) return layout
  const target = Math.max(0, Math.min(order.length - 1, toIndex))
  if (target === from) return layout
  const next = order.filter((other) => other !== id)
  next.splice(target, 0, id)
  return { ...layout, [zone]: next }
}

export function isDefaultLayout(layout: OverviewLayout) {
  return ZONE_IDS.every((zone) => layout[zone].join() === OVERVIEW_ZONES[zone].join())
}

export function loadOverviewLayout(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): OverviewLayout {
  try {
    const raw = storage?.getItem(OVERVIEW_LAYOUT_KEY)
    return sanitizeOverviewLayout(raw ? JSON.parse(raw) : undefined)
  } catch {
    return defaultOverviewLayout()
  }
}

export function saveOverviewLayout(layout: OverviewLayout, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage) {
  try {
    if (isDefaultLayout(layout)) storage?.removeItem(OVERVIEW_LAYOUT_KEY)
    else storage?.setItem(OVERVIEW_LAYOUT_KEY, JSON.stringify(layout))
  } catch { /* private mode or a full disk: the order lives for this session only */ }
}
