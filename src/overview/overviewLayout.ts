/**
 * «Настроить блоки» on the Overview (owner, 12.10.2026: «добавь функцию перемещение блоков на вкладке обзор… Каждый
 * блок не должен менять форму но можно переносить по вкладке обзор»; then «сделай что бы карта в блоке обзор
 * перемещалась» — the big raid map moves too). A block moves only among the places of its own shape, so it never
 * changes size:
 * - stats: the four small cards of the top row;
 * - rows: the full-width rows — the map priority strip stands above the cards, under them or at the very bottom;
 * - left: the wide column — the raid map, the squad and the raid requirements;
 * - right: the narrow column.
 * The order is kept on this computer (localStorage). Unknown ids are dropped, and blocks added later join at their
 * default place.
 */
export type OverviewZoneId = 'stats' | 'rows' | 'left' | 'right'

export type OverviewLayout = Record<OverviewZoneId, string[]>

export const OVERVIEW_ZONES: Readonly<Record<OverviewZoneId, readonly string[]>> = {
  // «Текущие задания» and «Приоритет карт» stand inside the map's block now (owner, 11.11.2026); «Экран» takes the first card.
  stats: ['stat-screen', 'stat-conditions', 'stat-kappa', 'stat-goons'],
  rows: ['stats', 'columns'],
  left: ['raid', 'squad', 'requirements'],
  right: ['tasks', 'gunsmith', 'favorites'],
}

/** Rows that are not dragged themselves: the card row and the two columns (the blocks inside them move). */
export const FIXED_BLOCKS: ReadonlySet<string> = new Set(['stats', 'columns'])

export const OVERVIEW_LAYOUT_KEY = 'raidos-overview-layout-v1'

/**
 * Blocks that were renamed: a saved order keeps them in their place. «Прогресс» (`stat-progress`, the completed-quest
 * counter) became «Условия квестов» (`stat-conditions`, owner, 15.10.2026) in the same slot.
 */
export const RENAMED_BLOCKS: Readonly<Record<string, string>> = {
  'stat-progress': 'stat-conditions',
  // «Экран» in the slot of «Текущие задания», whose count stands in the map's block now (owner, 11.11.2026)
  'stat-tasks': 'stat-screen',
}

/** A saved block id under its current name. */
export const currentBlockId = (id: string) => RENAMED_BLOCKS[id] ?? id

/** Blocks that are no more: «Приоритет карт» stands inside the map's block since 11.11.2026. */
export const RETIRED_BLOCKS: ReadonlySet<string> = new Set(['priority'])

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
    const list = Array.isArray(saved[zone]) ? (saved[zone] as unknown[]).filter((id): id is string => typeof id === 'string').map(currentBlockId).filter((id) => known.includes(id)) : []
    const order = [...new Set(list)]
    // New blocks (not in the saved order yet) take their default place.
    for (const id of known) if (!order.includes(id)) order.splice(Math.min(known.indexOf(id), order.length), 0, id)
    layout[zone] = order
  }
  // The card row always stays above the two columns.
  layout.rows = [...OVERVIEW_ZONES.rows]
  return layout
}

/** «Заменить блок» on the PC (owner, 11.11.2026): two blocks of one zone trade places; the same object when nothing changes. */
export function swapZoneBlocks(layout: OverviewLayout, zone: OverviewZoneId, id: string, chosen: string): OverviewLayout {
  const order = layout[zone]
  const from = order.indexOf(id), to = order.indexOf(chosen)
  if (from < 0 || to < 0 || from === to) return layout
  const next = [...order]
  next[from] = chosen
  next[to] = id
  return { ...layout, [zone]: next }
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

/** Same blocks in the same order in every zone. */
export function sameLayout(a: OverviewLayout, b: OverviewLayout) {
  return ZONE_IDS.every((zone) => a[zone].join() === b[zone].join())
}

/**
 * The layout is the starting one: the built-in order, or `base` — the owner's default for everybody
 * (src/overview/overviewDefaults.ts «Блоки»), which a player follows until they arrange the blocks themselves.
 */
export function isDefaultLayout(layout: OverviewLayout, base: OverviewLayout = defaultOverviewLayout()) {
  return sameLayout(layout, base)
}

/** The player's own order (sanitized), or `base` when they never arranged the blocks. */
export function loadOverviewLayout(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage, base?: OverviewLayout): OverviewLayout {
  try {
    const raw = storage?.getItem(OVERVIEW_LAYOUT_KEY)
    if (!raw && base) return base
    return sanitizeOverviewLayout(raw ? JSON.parse(raw) : undefined)
  } catch {
    return base ?? defaultOverviewLayout()
  }
}

/** Kept only when it differs from the starting one, so a player who never moved a block follows the owner's default. */
export function saveOverviewLayout(layout: OverviewLayout, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage, base?: OverviewLayout) {
  try {
    if (isDefaultLayout(layout, base)) storage?.removeItem(OVERVIEW_LAYOUT_KEY)
    else storage?.setItem(OVERVIEW_LAYOUT_KEY, JSON.stringify(layout))
  } catch { /* private mode or a full disk: the order lives for this session only */ }
}
