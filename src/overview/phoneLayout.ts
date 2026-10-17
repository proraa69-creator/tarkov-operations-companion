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
  'stat-tasks', 'stat-conditions', 'stat-kappa', 'stat-goons', 'priority', 'raid', 'squad', 'requirements', 'tasks', 'gunsmith', 'favorites',
] as const

/** The blocks that can be half wide. */
export const PHONE_NARROWABLE: ReadonlySet<string> = new Set(['stat-tasks', 'stat-conditions'])

export interface PhoneLayout {
  order: string[]
  /** Half-wide blocks (only PHONE_NARROWABLE ones). */
  narrow: string[]
}

export const PHONE_LAYOUT_KEY = 'raidos-overview-phone-v1'

/** The two counters start side by side. */
export function defaultPhoneLayout(): PhoneLayout {
  return { order: [...PHONE_BLOCKS], narrow: ['stat-tasks', 'stat-conditions'] }
}

const known = new Set<string>(PHONE_BLOCKS)

export function sanitizePhoneLayout(raw: unknown): PhoneLayout {
  const saved = raw && typeof raw === 'object' ? raw as Partial<Record<keyof PhoneLayout, unknown>> : {}
  if (!Array.isArray(saved.order)) return defaultPhoneLayout()
  // A renamed block (overviewLayout.ts RENAMED_BLOCKS) keeps its place and its width.
  const order = [...new Set(saved.order.filter((id): id is string => typeof id === 'string').map(currentBlockId).filter((id) => known.has(id)))]
  PHONE_BLOCKS.forEach((id, index) => { if (!order.includes(id)) order.splice(Math.min(index, order.length), 0, id) })
  const narrow = Array.isArray(saved.narrow) ? [...new Set(saved.narrow.filter((id): id is string => typeof id === 'string').map(currentBlockId).filter((id) => PHONE_NARROWABLE.has(id)))] : []
  return { order, narrow }
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

/** Half wide ↔ full width; only for PHONE_NARROWABLE blocks. */
export function togglePhoneNarrow(layout: PhoneLayout, id: string): PhoneLayout {
  if (!PHONE_NARROWABLE.has(id)) return layout
  const narrow = layout.narrow.includes(id) ? layout.narrow.filter((other) => other !== id) : [...layout.narrow, id]
  return { ...layout, narrow }
}

/** The starting layout: the built-in one, or `base` — the owner's default for everybody (overviewDefaults.ts «Блоки»). */
export function isDefaultPhoneLayout(layout: PhoneLayout, base: PhoneLayout = defaultPhoneLayout()) {
  return layout.order.join() === base.order.join() && [...layout.narrow].sort().join() === [...base.narrow].sort().join()
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
