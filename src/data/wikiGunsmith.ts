import type { Quest, WikiBuildPart } from '../domain/types'

/**
 * «Оружейник»: the parts of a weapon-build task from its wiki page (owner, 11.10.2026: «у каждого квеста есть ссылка
 * wiki, проходи по этой ссылке и бери от туда данные модулей»). tarkov.dev lists only what the game checks by item; the
 * English wiki's «Related Quest Items» table is a whole build that passes, with who sells each part and from which
 * loyalty level («Peacekeeper LL2 (Barter)»). The page is the one tarkov.dev links the task to (`wikiLink`), read as
 * rendered HTML (what the table shows on the site), kept for a while per page.
 */
const WIKI_ORIGIN = 'https://escapefromtarkov.fandom.com'
const PAGE_TTL_MS = 12 * 60 * 60 * 1000
const FAILED_TTL_MS = 30 * 60 * 1000
const PAGE_TIMEOUT_MS = 20_000
const CONCURRENCY = 4

/** Trader page titles on the wiki → tarkov.dev normalizedName. */
const TRADERS: Record<string, string> = {
  prapor: 'prapor', therapist: 'therapist', fence: 'fence', skier: 'skier', peacekeeper: 'peacekeeper', mechanic: 'mechanic',
  ragman: 'ragman', jaeger: 'jaeger', ref: 'ref', lightkeeper: 'lightkeeper', 'btr driver': 'btr-driver', 'flea market': 'flea-market',
}

export interface WikiBuildRow {
  name: string
  /** The wiki page the item links to (its title), when it differs from the shown name. */
  title?: string
  required?: boolean
  /** The weapon itself («Has to be modified and handed over»). */
  handover?: boolean
  sellers: WikiBuildPart['sellers']
}

/** English wiki page title of a tarkov.dev `wikiLink` (`…/wiki/Gunsmith_-_Part_1`); the Russian wiki is not used here. */
export function wikiPageTitle(link: string | undefined) {
  if (!link) return undefined
  try {
    const url = new URL(link)
    if (url.hostname !== 'escapefromtarkov.fandom.com') return undefined
    const match = /^\/wiki\/(.+)$/.exec(url.pathname)
    return match ? decodeURIComponent(match[1]).replace(/_/g, ' ') : undefined
  } catch { return undefined }
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' }
const decode = (value: string) => value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
  if (entity.startsWith('#')) {
    const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
  }
  return ENTITIES[entity.toLowerCase()] ?? match
})
const textOf = (html: string) => decode(html.replace(/<br\s*\/?>|<hr\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** Every `<table>` with its start and end (nested tables included), in document order. */
function tables(html: string) {
  const found: Array<{ start: number; end: number; depth: number }> = []
  const stack: number[] = []
  const tag = /<(\/?)table\b[^>]*>/gi
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    if (!match[1]) stack.push(match.index)
    else if (stack.length) {
      const start = stack.pop()!
      found.push({ start, end: match.index + match[0].length, depth: stack.length })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

/** The table's own rows (a nested table stays inside the row that holds it). */
function rows(table: string) {
  const inner = table.replace(/^<table\b[^>]*>/i, '').replace(/<\/table>$/i, '')
  const result: string[] = []
  let depth = 0
  let rowStart = -1
  const tag = /<(\/?)(table|tr)\b[^>]*>/gi
  for (let match = tag.exec(inner); match; match = tag.exec(inner)) {
    const closing = Boolean(match[1])
    const name = match[2].toLowerCase()
    if (name === 'table') depth += closing ? -1 : 1
    else if (depth === 0 && !closing) rowStart = match.index
    else if (depth === 0 && closing && rowStart >= 0) {
      result.push(inner.slice(rowStart, match.index + match[0].length))
      rowStart = -1
    }
  }
  return result
}

interface Link { title: string; text: string; at: number }
function links(row: string): Link[] {
  const result: Link[] = []
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  for (let match = anchor.exec(row); match; match = anchor.exec(row)) {
    const title = decode(/\btitle="([^"]*)"/i.exec(match[1])?.[1] ?? '').trim()
    const text = textOf(match[2])
    if (title || text) result.push({ title, text, at: match.index })
  }
  return result
}

const traderKeyOf = (link: Link) => TRADERS[(link.title || link.text).toLowerCase()] ?? TRADERS[link.text.toLowerCase()]
const NAMESPACED = /^[a-z ]+:/i
const LOYALTY = /\b(?:LL|Loyalty level)\s*([1-4])\b(\s*\(\s*barter\s*\))?/gi

/** Who sells the part from this row: each «LLn» goes to its trader (the one before it, or the same place in the list). */
function sellersOf(row: string, rowLinks: Link[]): WikiBuildPart['sellers'] {
  const traders = rowLinks.flatMap((link) => {
    const trader = traderKeyOf(link)
    return trader ? [{ trader, at: link.at }] : []
  })
  const levels: Array<{ level: number; barter: boolean; at: number; end: number }> = []
  for (let match = LOYALTY.exec(row); match; match = LOYALTY.exec(row)) levels.push({ level: Number(match[1]), barter: Boolean(match[2]), at: match.index, end: match.index + match[0].length })
  LOYALTY.lastIndex = 0
  const sellers: WikiBuildPart['sellers'] = []
  const add = (trader: string, level: number, barter: boolean) => {
    if (!sellers.some((seller) => seller.trader === trader && seller.level === level && Boolean(seller.barter) === barter)) sellers.push({ trader, level, ...(barter ? { barter: true } : {}) })
  }
  // «Peacekeeper / Mechanic» in one cell and «LL2 (Barter) / LL3» in the next: in the same order.
  const separateCells = traders.length > 1 && traders.length === levels.length && traders.every((trader) => trader.at < levels[0].at)
  levels.forEach((entry, index) => {
    const trader = separateCells ? traders[index] : [...traders].reverse().find((candidate) => candidate.at < entry.at) ?? traders[0]
    // «LL2 (Barter)», or in words: «bartered from Mechanic LL3» (the words since the level before it).
    const from = Math.max(trader ? trader.at - 40 : 0, index ? levels[index - 1].end : 0)
    const barter = entry.barter || (!separateCells && trader !== undefined && trader.at < entry.at && /barter/i.test(textOf(row.slice(from, entry.at))))
    if (trader) add(trader.trader, entry.level, barter)
  })
  for (const trader of traders) if (!sellers.some((seller) => seller.trader === trader.trader)) add(trader.trader, trader.trader === 'flea-market' ? 0 : 1, false)
  return sellers
}

/** The parts table of a rendered task page: «Related Quest Items», or any table that names traders with loyalty levels. */
export function parseWikiBuildTable(html: string): WikiBuildRow[] {
  const all = tables(html)
  const texts = all.map((table) => textOf(html.slice(table.start, table.end)))
  const related = all.filter((_, index) => /related quest items/i.test(texts[index].slice(0, 400)))
  // No «Related Quest Items» header: a table that names traders with loyalty levels.
  const chosen = related.length ? related : all.filter((_, index) => (texts[index].match(/\bLL\s*[1-4]\b/g) ?? []).length >= 2 && Object.keys(TRADERS).some((name) => texts[index].toLowerCase().includes(name)))
  // A chosen table inside another chosen one is read with it.
  const outer = chosen.filter((table) => !chosen.some((other) => other !== table && other.start < table.start && other.end > table.end))
  const result: WikiBuildRow[] = []
  for (const table of outer) {
    for (const row of rows(html.slice(table.start, table.end))) {
      if (/<th\b/i.test(row) && !/<td\b/i.test(row)) continue
      const rowLinks = links(row)
      // The name cell's link (the icon's link has no text).
      const candidates = rowLinks.filter((link) => !traderKeyOf(link) && !NAMESPACED.test(link.title))
      const item = candidates.find((link) => link.text) ?? candidates[0]
      const sellers = sellersOf(row, rowLinks)
      const text = textOf(row)
      if (!item) {
        // A trader on a row of its own continues the part above (rowspan).
        if (sellers.length && result.length) for (const seller of sellers) result[result.length - 1].sellers.push(seller)
        continue
      }
      const name = item.text || item.title
      if (result.some((entry) => entry.name === name)) continue
      result.push({
        name,
        ...(item.title && item.title !== name ? { title: item.title } : {}),
        ...(/\b(?:has|have|must) to be (?:installed|attached|mounted)|\bmust be (?:installed|attached|mounted)/i.test(text) ? { required: true } : {}),
        ...(/modified and handed over|hand(?:ed)? over/i.test(text) ? { handover: true } : {}),
        sellers,
      })
    }
  }
  return result
}

type Fetcher = typeof fetch
const pageCache = new Map<string, { at: number; rows?: WikiBuildRow[] }>()

async function fetchPage(title: string, fetcher: Fetcher): Promise<WikiBuildRow[] | undefined> {
  const cached = pageCache.get(title)
  if (cached && Date.now() - cached.at < (cached.rows ? PAGE_TTL_MS : FAILED_TTL_MS)) return cached.rows
  const params = new URLSearchParams({ action: 'parse', page: title, prop: 'text', format: 'json', formatversion: '2', redirects: '1', origin: '*' })
  try {
    const response = await fetcher(`${WIKI_ORIGIN}/api.php?${params.toString()}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`wiki ${response.status}`)
    const payload = await response.json() as { parse?: { text?: string | { '*'?: string } } }
    const text = payload.parse?.text
    const html = typeof text === 'string' ? text : text?.['*'] ?? ''
    const parsed = parseWikiBuildTable(html)
    pageCache.set(title, { at: Date.now(), rows: parsed })
    return parsed
  } catch {
    pageCache.set(title, { at: Date.now() })
    return undefined
  }
}

/**
 * The wiki tables of these pages, a few at a time; a page that fails is left out and tried again later. No new page is
 * started after `budgetMs`, so a slow wiki never holds the catalog up for long (the pages read so far are kept).
 */
export async function fetchWikiBuildTables(titles: string[], fetcher: Fetcher = fetch, budgetMs = 60_000) {
  const queue = [...new Set(titles)]
  const result = new Map<string, WikiBuildRow[]>()
  const deadline = Date.now() + budgetMs
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let title = queue.shift(); title && Date.now() < deadline; title = queue.shift()) {
      const parsed = await fetchPage(title, fetcher)
      if (parsed?.length) result.set(title, parsed)
    }
  }))
  return result
}

/**
 * Lays the wiki parts over the tasks' builds. `resolve` finds the catalog item by the wiki's (English) name; a part the
 * wiki says must be installed joins the parts the build must hold.
 */
export function withWikiBuilds(quests: Quest[], tables: Map<string, WikiBuildRow[]>, resolve: (name: string) => string | undefined): Quest[] {
  if (!tables.size) return quests
  return quests.map((quest) => {
    const title = wikiPageTitle(quest.wikiLink)
    const table = title ? tables.get(title) : undefined
    if (!table || !quest.objectiveDetails?.some((objective) => objective.build)) return quest
    return {
      ...quest,
      objectiveDetails: quest.objectiveDetails.map((objective) => {
        const build = objective.build
        if (!build) return objective
        const parts: WikiBuildPart[] = table.flatMap((row) => {
          const itemId = resolve(row.name) ?? (row.title ? resolve(row.title) : undefined)
          if (row.handover || (itemId && itemId === build.weaponId)) return []
          return [{ ...(itemId ? { itemId } : {}), name: row.name, ...(row.required ? { required: true } : {}), sellers: row.sellers }]
        })
        if (!parts.length) return objective
        const required = parts.flatMap((part) => (part.required && part.itemId ? [part.itemId] : []))
        return { ...objective, build: { ...build, partIds: [...new Set([...build.partIds, ...required])], wikiParts: parts } }
      }),
    }
  })
}

/** Finds an item by its English name, else its short name (one item only), ignoring case, spaces and punctuation. */
export function englishItemResolver(items: Array<{ id?: unknown; name?: unknown; shortName?: unknown }>) {
  const key = (value: unknown) => (typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '') : '')
  const index = (field: 'name' | 'shortName') => {
    const map = new Map<string, string | null>()
    for (const item of items) {
      const k = key(item[field])
      if (!k || typeof item.id !== 'string') continue
      const known = map.get(k)
      map.set(k, known === undefined || known === item.id ? item.id : null)
    }
    return map
  }
  const byName = index('name')
  const byShortName = index('shortName')
  return (name: string) => byName.get(key(name)) ?? byShortName.get(key(name)) ?? undefined
}
