import type { BuildGuidePart, Quest } from '../domain/types'

/**
 * «Оружейник» builds from tarkov.help (owner, 11.10.2026: «возьми с тарков хелпа все квесты оружейник и собери как у них,
 * в том числе картинка с готовой сборкой оружия»). Each task page there has one ready build per weapon: a table of the items
 * to buy (game item ids, the same as tarkov.dev's) with the trader and loyalty level each comes from, or «Цена в
 * барахолке» / «Нельзя купить», and a screenshot of the game's «Сборки оружия» screen with the build finished.
 *
 * The site is a Next.js app: the task is in the page's React Server Components payload (`self.__next_f.push`), its guide
 * rendered to HTML in a text chunk of that payload. Tasks are found by their Russian name in the trader's task list.
 * Pages are kept for a while, a few at a time, within a time budget per catalog build (the catalog never waits long).
 */
export const TARKOV_HELP_ORIGIN = 'https://tarkov.help'
const PAGE_TTL_MS = 12 * 60 * 60 * 1000
const FAILED_TTL_MS = 30 * 60 * 1000
const PAGE_TIMEOUT_MS = 20_000
const CONCURRENCY = 3

/** tarkov.dev trader normalizedName → tarkov.help trader slug (and back). */
const SLUG_OF_TRADER: Record<string, string> = { peacekeeper: 'peacemaker', 'btr-driver': 'btr_driver' }
const TRADER_OF_SLUG: Record<string, string> = Object.fromEntries(Object.entries(SLUG_OF_TRADER).map(([trader, slug]) => [slug, trader]))
export const helpTraderSlug = (trader: string) => SLUG_OF_TRADER[trader] ?? trader

/** One build of a task page: the items in the table's order (the weapon among them), who sells each, the screenshot. */
export interface HelpBuildTable {
  itemIds: string[]
  sellers: Record<string, HelpSeller>
  names: Record<string, string>
  image?: string
}
export type HelpSeller = { trader: string; level: number } | { fleaOnly: true } | { notSold: true }

export interface HelpQuestGuide {
  url: string
  name: string
  tables: HelpBuildTable[]
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—' }
const decode = (value: string) => value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
  if (entity.startsWith('#')) {
    const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
  }
  return ENTITIES[entity.toLowerCase()] ?? match
})
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** Latin look-alikes folded, case, «ё», spaces and punctuation ignored: «Оружейник. АС «Вал»» = «Оружейник. АС "Вал"». */
const LOOKALIKES: Record<string, string> = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н' }
export function helpNameKey(name: string) {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/[aceopxykmtbh]/g, (char) => LOOKALIKES[char] ?? char).replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The page's React Server Components payload: every `self.__next_f.push([1, "…"])` string, in order. */
export function rscPayload(html: string) {
  let payload = ''
  const push = /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g
  for (let match = push.exec(html); match; match = push.exec(html)) {
    try {
      const entry = JSON.parse(match[1]) as unknown[]
      if (entry[0] === 1 && typeof entry[1] === 'string') payload += entry[1]
    } catch { /* not a payload string */ }
  }
  return payload
}

/** The JSON object that starts at `from` (strings and nesting respected). */
function objectAt(text: string, from: number): Record<string, unknown> | undefined {
  const start = text.indexOf('{', from)
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, index + 1)) as Record<string, unknown> } catch { return undefined }
      }
    }
  }
  return undefined
}

/** A text chunk of the payload (`3c:T2be3,<2be3 hex bytes of UTF-8>`), by its reference (`$3c`). */
export function rscText(payload: string, reference: string) {
  const id = reference.startsWith('$') ? reference.slice(1) : reference
  const header = new RegExp(`(?:^|\\n)${id.replace(/[^0-9a-z]/gi, '')}:T([0-9a-f]+),`)
  const match = header.exec(payload)
  if (!match) return undefined
  let bytes = Number.parseInt(match[1], 16)
  let index = match.index + match[0].length
  const start = index
  while (bytes > 0 && index < payload.length) {
    const code = payload.codePointAt(index)!
    bytes -= code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    index += code >= 0x10000 ? 2 : 1
  }
  return payload.slice(start, index)
}

/** A value of the task object: a string as it is, a `$ref` resolved to its text chunk. */
const resolved = (payload: string, value: unknown) => (typeof value === 'string' && /^\$[0-9a-z]+$/i.test(value) ? rscText(payload, value) : typeof value === 'string' ? value : undefined)

/** The builds of a rendered guide: each items table with the screenshot that follows it. */
export function parseGuideTables(guideHtml: string): HelpBuildTable[] {
  // Tables and screenshots found apart (a screenshot's caption has a «bb-image__…» class too), then walked in page order.
  const blocks: Array<{ at: number; table?: string; image?: string }> = []
  for (const match of guideHtml.matchAll(/<table class="bb-table _items"[\s\S]*?<\/table>/g)) blocks.push({ at: match.index!, table: match[0] })
  for (const match of guideHtml.matchAll(/<div class="bb-image(?:\s[^"]*)?"[^>]*>\s*<div class="bb-image__image">\s*<img[^>]*\bsrc="([^"]+)"/g)) blocks.push({ at: match.index!, image: decode(match[1]) })
  blocks.sort((a, b) => a.at - b.at)
  const tables: HelpBuildTable[] = []
  let pendingImage: string | undefined
  for (const block of blocks) {
    if (block.image) {
      const last = tables[tables.length - 1]
      if (last && !last.image) last.image = block.image
      else if (!last) pendingImage ??= block.image
      continue
    }
    const table: HelpBuildTable = { itemIds: [], sellers: {}, names: {} }
    for (const cells of block.table!.matchAll(/<tr class="bb-item">([\s\S]*?)<\/tr>/g)) {
      const html = cells[1]
      const id = /\/img\/items\/([0-9a-f]{24})\.(?:png|webp|jpg)/.exec(html)?.[1]
      if (!id || table.itemIds.includes(id)) continue
      table.itemIds.push(id)
      const short = /<span class="item-shortname">([\s\S]*?)<\/span>/.exec(html)?.[1]
      if (short) table.names[id] = textOf(short)
      const trader = /\/img\/traders\/([a-z_]+)\.(?:png|webp)/.exec(html)?.[1]
      const level = Number(/loyalty\/loyalty_(\d)\.svg/.exec(html)?.[1])
      const cell = textOf(html.slice(html.indexOf('bb-table-trader')))
      if (trader) table.sellers[id] = { trader: TRADER_OF_SLUG[trader] ?? trader, level: level >= 1 && level <= 4 ? level : 1 }
      else if (/барахолк/i.test(cell)) table.sellers[id] = { fleaOnly: true }
      else if (/нельзя купить/i.test(cell)) table.sellers[id] = { notSold: true }
    }
    if (pendingImage) { table.image = pendingImage; pendingImage = undefined }
    if (table.itemIds.length) tables.push(table)
  }
  return tables
}

/** A task page: its name and builds (the rendered guide; the raw `[itemTable=…]` lists when it is not there). */
export function parseQuestPage(html: string): { name: string; tables: HelpBuildTable[] } | undefined {
  const payload = rscPayload(html)
  const at = payload.indexOf('"quest":{"id":')
  const quest = at >= 0 ? objectAt(payload, at + 8) : undefined
  if (!quest || typeof quest.name !== 'string') return undefined
  const rendered = resolved(payload, quest.guide)
  let tables = rendered ? parseGuideTables(rendered) : []
  if (!tables.length) {
    const raw = resolved(payload, quest.guides) ?? ''
    tables = [...raw.matchAll(/\[itemTable=([^\]]+)\]/g)].map((match) => ({
      itemIds: match[1].split(',').map((id) => id.trim()).filter((id) => /^[0-9a-f]{24}$/.test(id)), sellers: {}, names: {},
    })).filter((table) => table.itemIds.length)
  }
  return { name: quest.name, tables }
}

/** A trader's task list: each task's page slug by its name. */
export function parseQuestIndex(html: string) {
  const out: Array<{ slug: string; name: string }> = []
  const anchor = /<a\b[^>]*href="\/ru\/quest\/([^"#?/]+)"[^>]*>([\s\S]*?)<\/a>/g
  for (let match = anchor.exec(html); match; match = anchor.exec(html)) {
    const name = textOf(match[2])
    if (name) out.push({ slug: match[1], name })
  }
  return out
}

type Fetcher = typeof fetch
const pageCache = new Map<string, { at: number; text?: string }>()

async function fetchText(url: string, fetcher: Fetcher) {
  const cached = pageCache.get(url)
  if (cached && Date.now() - cached.at < (cached.text ? PAGE_TTL_MS : FAILED_TTL_MS)) return cached.text
  try {
    const response = await fetcher(url, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`tarkov.help ${response.status}`)
    const text = await response.text()
    pageCache.set(url, { at: Date.now(), text })
    return text
  } catch {
    pageCache.set(url, { at: Date.now() })
    return undefined
  }
}

/**
 * The tarkov.help guides of these tasks (by task id): the trader lists give each task's page by its Russian name, then
 * the pages are read a few at a time. No new page is started after `budgetMs`; the ones read so far are kept.
 */
export async function fetchTarkovHelpGuides(tasks: Array<{ id: string; name: string; trader?: string }>, fetcher: Fetcher = fetch, budgetMs = 60_000) {
  const deadline = Date.now() + budgetMs
  const result = new Map<string, HelpQuestGuide>()
  if (!tasks.length) return result
  const traders = [...new Set(tasks.map((task) => helpTraderSlug(task.trader || 'mechanic')))]
  const slugByName = new Map<string, string>()
  for (const trader of traders) {
    const html = await fetchText(`${TARKOV_HELP_ORIGIN}/ru/trader/${trader}/quests`, fetcher)
    for (const entry of html ? parseQuestIndex(html) : []) if (!slugByName.has(helpNameKey(entry.name))) slugByName.set(helpNameKey(entry.name), entry.slug)
  }
  const queue = tasks.flatMap((task) => {
    const slug = slugByName.get(helpNameKey(task.name))
    return slug ? [{ task, url: `${TARKOV_HELP_ORIGIN}/ru/quest/${slug}` }] : []
  })
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next && Date.now() < deadline; next = queue.shift()) {
      const html = await fetchText(next.url, fetcher)
      const page = html ? parseQuestPage(html) : undefined
      if (page?.tables.length) result.set(next.task.id, { url: next.url, name: page.name, tables: page.tables })
    }
  }))
  return result
}

/**
 * Lays tarkov.help's builds over the tasks' build objectives: the table that holds the objective's weapon, else the one in
 * the same place (a task with several weapons has a table per weapon). The weapon itself (and any other weapon, a preset of
 * it) is not a part; a part the task asks for by item is marked required.
 */
export function withHelpGuides(quests: Quest[], guides: Map<string, HelpQuestGuide>, isWeapon: (itemId: string) => boolean): Quest[] {
  if (!guides.size) return quests
  return quests.map((quest) => {
    const guide = guides.get(quest.id)
    const builds = (quest.objectiveDetails ?? []).filter((objective) => objective.build)
    if (!guide || !builds.length) return quest
    const used = new Set<HelpBuildTable>()
    const tableFor = (weaponId: string, index: number) => {
      const own = guide.tables.find((table) => !used.has(table) && table.itemIds.includes(weaponId))
      const table = own ?? (guide.tables.length === builds.length ? guide.tables[index] : builds.length === 1 ? guide.tables[0] : undefined)
      if (table) used.add(table)
      return table
    }
    let buildIndex = 0
    return {
      ...quest,
      objectiveDetails: quest.objectiveDetails!.map((objective) => {
        const build = objective.build
        if (!build) return objective
        const table = tableFor(build.weaponId, buildIndex++)
        if (!table) return objective
        const parts: BuildGuidePart[] = table.itemIds.filter((id) => id !== build.weaponId && !isWeapon(id)).map((itemId) => {
          const seller = table.sellers[itemId]
          return {
            itemId,
            name: table.names[itemId] ?? itemId,
            ...(build.partIds.includes(itemId) ? { required: true } : {}),
            sellers: seller && 'trader' in seller ? [{ trader: seller.trader, level: seller.level }] : [],
            ...(seller && 'fleaOnly' in seller ? { fleaOnly: true } : {}),
            ...(seller && 'notSold' in seller ? { notSold: true } : {}),
          }
        })
        return { ...objective, build: { ...build, guide: { source: 'tarkov.help' as const, url: guide.url, ...(table.image ? { image: table.image } : {}), parts } } }
      }),
    }
  })
}
