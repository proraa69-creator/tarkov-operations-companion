import { defaultOverviewLayout, FIXED_BLOCKS, OVERVIEW_ZONES, sanitizeOverviewLayout, type OverviewLayout, type OverviewZoneId } from './overviewLayout'
import { defaultPhoneLayout, PHONE_BLOCKS, sanitizePhoneLayout, type PhoneLayout } from './phoneLayout'

/**
 * «Блоки» of the owner's «Админ панель» (owner, 16.10.2026: «функции редактирования блоков… логический конструктор,
 * который я смогу редактировать и обновлять информацию, без надобности загружать обновление сервера»): the Overview as
 * every player gets it until they arrange it themselves —
 * - `layout`: the default order of the blocks on the PC (the zones of overviewLayout.ts; absent: the built-in order);
 * - `phone`: the default order on the phone (phoneLayout.ts; absent: the built-in order);
 * - `hidden`: blocks nobody sees (the owner hides a block for everybody);
 * - `titles`: the owner's own heading of a block, RU and EN (an empty one keeps the built-in heading of that language).
 *
 * Shared by the server (server/src/routes/overviewDefaults.ts validates and keeps it) and the apps
 * (src/overview/overviewDefaultsStore.ts, read with the owner's notice at GET /v1/announcement). A player's own
 * «Настроить блоки» order wins over the default order; hidden blocks stay hidden for everybody.
 */
export interface BlockTitle { ru: string; en: string }

export interface OverviewDefaults {
  layout?: OverviewLayout
  phone?: string[]
  hidden: string[]
  titles: Record<string, BlockTitle>
  updatedAt?: string
}

/** Every block the owner can order, hide or rename, with its built-in heading (RU; the interface translates it). */
export const OVERVIEW_BLOCKS: ReadonlyArray<{ id: string; label: string; zone: OverviewZoneId }> = [
  { id: 'stat-tasks', label: 'Текущие задания', zone: 'stats' },
  { id: 'stat-conditions', label: 'Сбор на рейд', zone: 'stats' },
  { id: 'stat-kappa', label: 'Задания для Капы', zone: 'stats' },
  { id: 'stat-goons', label: 'Кочевники', zone: 'stats' },
  { id: 'priority', label: 'Приоритет карт', zone: 'rows' },
  { id: 'raid', label: 'План рейда', zone: 'left' },
  { id: 'squad', label: 'Отряд', zone: 'left' },
  { id: 'requirements', label: 'Требования рейда', zone: 'left' },
  { id: 'tasks', label: 'Список текущих заданий', zone: 'right' },
  { id: 'gunsmith', label: 'Оружейник', zone: 'right' },
  { id: 'favorites', label: 'Рынок · избранное', zone: 'right' },
]

export const OVERVIEW_BLOCK_IDS: ReadonlySet<string> = new Set(OVERVIEW_BLOCKS.map((block) => block.id))
export const blockLabel = (id: string) => OVERVIEW_BLOCKS.find((block) => block.id === id)?.label ?? id

export const OVERVIEW_TITLE_MAX = 40

const printable = (value: string) => [...value].filter((char) => {
  const code = char.charCodeAt(0)
  return code >= 32 && code !== 127
}).join('').trim()

const titleText = (value: unknown) => (typeof value === 'string' ? printable(value).slice(0, OVERVIEW_TITLE_MAX) : '')

/** Ids of `raw` that are blocks the owner may hide, once each. */
const blockIds = (raw: unknown) => (Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && OVERVIEW_BLOCK_IDS.has(id)))] : [])

/** The stored or received defaults made safe (unknown blocks dropped, every zone complete); null for anything else. */
export function sanitizeOverviewDefaults(raw: unknown): OverviewDefaults | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const titles: Record<string, BlockTitle> = {}
  if (value.titles && typeof value.titles === 'object') {
    for (const [id, entry] of Object.entries(value.titles as Record<string, unknown>)) {
      if (!OVERVIEW_BLOCK_IDS.has(id) || !entry || typeof entry !== 'object') continue
      const ru = titleText((entry as Record<string, unknown>).ru)
      const en = titleText((entry as Record<string, unknown>).en)
      if (ru || en) titles[id] = { ru, en }
    }
  }
  const layout = value.layout && typeof value.layout === 'object' ? sanitizeOverviewLayout(value.layout) : undefined
  const phone = Array.isArray(value.phone) ? sanitizePhoneLayout({ order: value.phone }).order : undefined
  return {
    ...(layout ? { layout } : {}),
    ...(phone ? { phone } : {}),
    hidden: blockIds(value.hidden),
    titles,
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt.slice(0, 40) } : {}),
  }
}

/** True when `defaults` change nothing for the players (the built-in Overview). */
export function isBuiltInOverview(defaults: OverviewDefaults | null | undefined) {
  if (!defaults) return true
  const builtIn = defaultOverviewLayout()
  const layoutSame = !defaults.layout || (Object.keys(OVERVIEW_ZONES) as OverviewZoneId[]).every((zone) => defaults.layout![zone].join() === builtIn[zone].join())
  const phoneSame = !defaults.phone || defaults.phone.join() === PHONE_BLOCKS.join()
  return layoutSame && phoneSame && !defaults.hidden.length && !Object.keys(defaults.titles).length
}

/** `layout` without the hidden blocks (the card row and the two columns always stay). */
export function withoutHiddenBlocks(layout: OverviewLayout, hidden: readonly string[]): OverviewLayout {
  if (!hidden.length) return layout
  const off = new Set(hidden)
  const keep = (id: string) => FIXED_BLOCKS.has(id) || !off.has(id)
  return { stats: layout.stats.filter(keep), rows: layout.rows.filter(keep), left: layout.left.filter(keep), right: layout.right.filter(keep) }
}

/** The PC's starting Overview: the owner's order (or the built-in one) without the hidden blocks. */
export function baseOverviewLayout(defaults: OverviewDefaults | null | undefined): OverviewLayout {
  return withoutHiddenBlocks(defaults?.layout ? sanitizeOverviewLayout(defaults.layout) : defaultOverviewLayout(), defaults?.hidden ?? [])
}

/** The phone's starting Overview: the owner's order (or the built-in one) without the hidden blocks. */
export function basePhoneLayout(defaults: OverviewDefaults | null | undefined): PhoneLayout {
  const base = defaultPhoneLayout()
  const order = defaults?.phone ? sanitizePhoneLayout({ order: defaults.phone }).order : base.order
  const off = new Set(defaults?.hidden ?? [])
  // The two small counters stand side by side at the top (owner, 17.10.2026): «Задания для Капы» right after «Текущие задания».
  const visible = order.filter((id) => !off.has(id))
  const tasks = visible.indexOf('stat-tasks')
  const kappa = visible.indexOf('stat-kappa')
  if (tasks >= 0 && kappa >= 0 && kappa !== tasks + 1) {
    visible.splice(kappa, 1)
    visible.splice(visible.indexOf('stat-tasks') + 1, 0, 'stat-kappa')
  }
  return { order: visible, narrow: base.narrow }
}

/** A phone layout without the hidden blocks. */
export function phoneWithoutHidden(layout: PhoneLayout, hidden: readonly string[]): PhoneLayout {
  if (!hidden.length) return layout
  const off = new Set(hidden)
  return { ...layout, order: layout.order.filter((id) => !off.has(id)) }
}

/** The owner's heading of a block in `locale`, or undefined for the built-in one. */
export function ownBlockTitle(defaults: OverviewDefaults | null | undefined, id: string, locale: 'ru' | 'en') {
  return defaults?.titles[id]?.[locale]?.trim() || undefined
}
