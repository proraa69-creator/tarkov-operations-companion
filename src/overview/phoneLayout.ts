import { currentBlockId } from './overviewLayout'

/**
 * The Overview on the phone (owner, 13.10.2026: «добавь так же перенос блоков вверх или вниз, так как тут одна полоса с
 * блоками, то их все можно менять и перемещать как удобно. сделай возможность верхних блоков а именно текущие задания,
 * прогресс сужать и ставить оба рядом на одном уровне»): one column, so every block — the raid map too — moves up or
 * down anywhere; «Текущие задания» and «Прогресс» (now «Условия квестов») can be half wide, and two half-wide blocks in a row stand side by side.
 * Kept on this phone (localStorage), apart from the desktop layout (overviewLayout.ts). Unknown ids are dropped and
 * blocks added later join at their default place.
 */
export const PHONE_BLOCKS = [
  'stat-tasks', 'stat-kappa', 'stat-conditions', 'stat-goons', 'priority', 'raid', 'squad', 'requirements', 'tasks', 'gunsmith', 'favorites',
] as const

/**
 * The blocks that can be half wide: every one (owner, 20.10.2026: «у всех блоков должны быть одинаковые настройки… все
 * блоки можно будет сложить и расставить как удобно»); two half-wide blocks in a row stand side by side, and what is
 * inside fits itself to the block (styles/overviewEdit.css `.phone-block.is-small`).
 */
export const PHONE_NARROWABLE: ReadonlySet<string> = new Set(PHONE_BLOCKS)

export interface PhoneLayout {
  order: string[]
  /** Half-wide blocks (only PHONE_NARROWABLE ones). */
  narrow: string[]
  /**
   * Sizes the player dragged by a block's corner in «Настроить блоки» (owner, 17.10.2026: «любой размер»): `w` the share of
   * the screen's width (0.25–1), `h` the height in pixels (absent: the block's own height). Absent block: its default.
   */
  sizes?: Record<string, PhoneBlockSize>
}

export interface PhoneBlockSize { w?: number; h?: number }

export const PHONE_MIN_WIDTH = 0.25
export const PHONE_MIN_HEIGHT = 64
export const PHONE_MAX_HEIGHT = 1400

/** A size within the limits (width to 1 %, height to a pixel); undefined when nothing is left of it. */
export function cleanPhoneSize(raw: unknown): PhoneBlockSize | undefined {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const w = typeof value.w === 'number' && Number.isFinite(value.w) ? Math.round(Math.min(1, Math.max(PHONE_MIN_WIDTH, value.w)) * 100) / 100 : undefined
  const h = typeof value.h === 'number' && Number.isFinite(value.h) ? Math.round(Math.min(PHONE_MAX_HEIGHT, Math.max(PHONE_MIN_HEIGHT, value.h))) : undefined
  return w === undefined && h === undefined ? undefined : { ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) }
}

/** The block's own size (dragged in «Настроить блоки»), or undefined back to its default. */
export function resizePhoneBlock(layout: PhoneLayout, id: string, size: PhoneBlockSize | undefined): PhoneLayout {
  const sizes = { ...(layout.sizes ?? {}) }
  const clean = size ? cleanPhoneSize(size) : undefined
  if (clean) sizes[id] = clean
  else delete sizes[id]
  const { sizes: _old, ...rest } = layout
  void _old
  return Object.keys(sizes).length ? { ...rest, sizes } : rest
}

/** v2 (17.10.2026): the new top row is everybody's start again; an arrangement of v1 is not carried over. */
export const PHONE_LAYOUT_KEY = 'raidos-overview-phone-v2'

/** The two counters start side by side. */
export function defaultPhoneLayout(): PhoneLayout {
  return { order: [...PHONE_BLOCKS], narrow: ['stat-tasks', 'stat-kappa'] }
}

const known = new Set<string>(PHONE_BLOCKS)

export function sanitizePhoneLayout(raw: unknown): PhoneLayout {
  const saved = raw && typeof raw === 'object' ? raw as Partial<Record<keyof PhoneLayout, unknown>> : {}
  if (!Array.isArray(saved.order)) return defaultPhoneLayout()
  // A renamed block (overviewLayout.ts RENAMED_BLOCKS) keeps its place and its width.
  const order = [...new Set(saved.order.filter((id): id is string => typeof id === 'string').map(currentBlockId).filter((id) => known.has(id)))]
  PHONE_BLOCKS.forEach((id, index) => { if (!order.includes(id)) order.splice(Math.min(index, order.length), 0, id) })
  const narrow = Array.isArray(saved.narrow) ? [...new Set(saved.narrow.filter((id): id is string => typeof id === 'string').map(currentBlockId).filter((id) => PHONE_NARROWABLE.has(id)))] : []
  const sizes: Record<string, PhoneBlockSize> = {}
  if (saved.sizes && typeof saved.sizes === 'object') {
    for (const [id, raw] of Object.entries(saved.sizes as Record<string, unknown>)) {
      const block = currentBlockId(id)
      const clean = known.has(block) ? cleanPhoneSize(raw) : undefined
      if (clean) sizes[block] = clean
    }
  }
  return Object.keys(sizes).length ? { order, narrow, sizes } : { order, narrow }
}

/** `id` one place up (-1) or down (+1); the same object at either end. */
export function movePhoneBlock(layout: PhoneLayout, id: string, step: -1 | 1): PhoneLayout {
  const from = layout.order.indexOf(id)
  const to = from + step
  if (from < 0 || to < 0 || to >= layout.order.length) return layout
  const order = [...layout.order]
  order.splice(from, 1)
  order.splice(to, 0, id)
  return { ...layout, order }
}

/**
 * The held block takes the place of the one it was dropped on, and that one takes the held block's old place (owner,
 * 28.10.2026: «зажимаешь, переносишь… и то место, которое ты ставишь, переносится на то же место, где был удерживаемый
 * блок»). The same object when either is missing or they are the same.
 */
export function swapPhoneBlocks(layout: PhoneLayout, id: string, target: string): PhoneLayout {
  const from = layout.order.indexOf(id)
  const to = layout.order.indexOf(target)
  if (from < 0 || to < 0 || from === to) return layout
  const order = [...layout.order]
  order[from] = target
  order[to] = id
  return { ...layout, order }
}

/**
 * «Пополам» / «Во всю ширину» for any block, whatever width its corner gave it: half sets the block narrow, full makes
 * it full width; either way a dragged width goes (the height stays), so the button always does what it shows.
 */
export function setPhoneHalf(layout: PhoneLayout, id: string, half: boolean): PhoneLayout {
  if (!PHONE_NARROWABLE.has(id)) return layout
  const others = layout.narrow.filter((other) => other !== id)
  const own = layout.sizes?.[id]
  const next: PhoneLayout = { ...layout, narrow: half ? [...others, id] : others }
  return own?.w !== undefined ? resizePhoneBlock(next, id, own.h !== undefined ? { h: own.h } : undefined) : next
}

/** Half wide ↔ full width; only for PHONE_NARROWABLE blocks. */
export function togglePhoneNarrow(layout: PhoneLayout, id: string): PhoneLayout {
  if (!PHONE_NARROWABLE.has(id)) return layout
  const narrow = layout.narrow.includes(id) ? layout.narrow.filter((other) => other !== id) : [...layout.narrow, id]
  return { ...layout, narrow }
}

/** The starting layout: the built-in one, or `base` — the owner's default for everybody (overviewDefaults.ts «Блоки»). */
export function isDefaultPhoneLayout(layout: PhoneLayout, base: PhoneLayout = defaultPhoneLayout()) {
  const sizes = (value: PhoneLayout) => JSON.stringify(Object.entries(value.sizes ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  return layout.order.join() === base.order.join() && [...layout.narrow].sort().join() === [...base.narrow].sort().join() && sizes(layout) === sizes(base)
}

/** The player's own layout (sanitized), or `base` when they never arranged the blocks. */
export function loadPhoneLayout(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage, base: PhoneLayout = defaultPhoneLayout()): PhoneLayout {
  try {
    const raw = storage?.getItem(PHONE_LAYOUT_KEY)
    return raw ? sanitizePhoneLayout(JSON.parse(raw)) : base
  } catch {
    return base
  }
}

/** Kept only when it differs from the starting one, so a player who never moved a block follows the owner's default. */
export function savePhoneLayout(layout: PhoneLayout, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage, base?: PhoneLayout) {
  try {
    if (isDefaultPhoneLayout(layout, base)) storage?.removeItem(PHONE_LAYOUT_KEY)
    else storage?.setItem(PHONE_LAYOUT_KEY, JSON.stringify(layout))
  } catch { /* private mode or a full disk: the order lives for this session only */ }
}
