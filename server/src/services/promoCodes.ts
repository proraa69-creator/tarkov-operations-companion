import type { DatabaseSync } from 'node:sqlite'

/**
 * «Промокоды» (owner, 06.11.2026: «проверяй из открытых источников все активные промокоды… Выбери несколько источников, чтобы
 * сервер проверял»; «каждые 2 часа, и как только он нашел новый, он добавляет их в приложение»). Every two hours the server
 * reads the pages below and takes each one's list of active codes. A code counts once two pages list it, so one page's typo
 * or stale line does not reach the players. A code once added stays on the list (owner, 25.11.2026: «Промокоды, которые у нас
 * добавлены, убирать не нужно. Пусть они висят списком. Просто у нас должны добавляться новые»). The apps never see where a
 * code came from.
 */
export interface PromoSource {
  id: string
  url: string
  /** The heading above the page's active codes, and the first heading after them. */
  from: RegExp
  to: RegExp
  /** Words inside that part where its active codes end (a page that puts «might have expired» under the same heading). */
  until?: RegExp
}

export const PROMO_SOURCES: readonly PromoSource[] = [
  { id: 'gamesradar', url: 'https://www.gamesradar.com/games/fps/escape-from-tarkov-codes-promo/', from: /^all escape from tarkov codes/i, to: /^(how to|expired)/i },
  { id: 'beebom', url: 'https://beebom.com/escape-from-tarkov-codes/', from: /^all new escape from tarkov codes/i, to: /^(expired|how to)/i },
  { id: 'gamespec', url: 'https://gamespec.co.uk/escape-from-tarkov-promo-codes/', from: /^active eft promo codes/i, to: /^(free roubles|how to|why a)/i },
  { id: 'esports', url: 'https://esports.ru/igrovaya-industriya/articles/promokody-escape-from-tarkov-2026/', from: /^рабочие промокоды/i, to: /^(как активировать|часто задаваемые)/i },
  { id: 'metaratings', url: 'https://cybersport.metaratings.ru/wiki/promokody-escape-from-tarkov/', from: /^действующие промокоды/i, to: /^(куда вводить|истекшие|почему)/i },
  // Fresher pages (25.11.2026: insider-gaming answers 403, PCGamesN and GameSpec were last updated in October)
  { id: 'dexerto', url: 'https://www.dexerto.com/escape-from-tarkov/all-escape-from-tarkov-promo-codes-and-discounts-1752105/', from: /^active escape from tarkov codes/i, to: /^(escape from tarkov discounts|how to redeem|list of expired)/i },
  { id: 'timesaver', url: 'https://timesaver.gg/blog/tarkov-promo-codes-october-2026', from: /^which tarkov codes are active/i, to: /^(how do you redeem|why isn)/i },
  // report №99 (08.11.2026): the first page to list the studio's codes of 07.11
  { id: 'insider-gaming', url: 'https://insider-gaming.com/all-escape-from-tarkov-codes-rewards/', from: /^all active escape from tarkov codes/i, to: /^(how to|expired)/i, until: /might have expired/i },
]

/**
 * Codes the studio posted itself (report №99, 08.11.2026: «PLAYYOURWAY EMBRACEPAIN»; Nikita Buyanov, 07.11.2026: one for PvE,
 * one for PvP and the PvP season). Shown from `from` on, even while fewer than two pages list them (`until` no longer takes them
 * off: owner, 25.11.2026, codes stay); once the pages
 * list them they are the pages' like any other.
 */
export interface AnnouncedPromoCode { code: string; mode: PromoMode; from: string; until: string }
export const ANNOUNCED_PROMO_CODES: readonly AnnouncedPromoCode[] = [
  { code: 'PLAYYOURWAY', mode: 'pve', from: '2026-11-07T12:00:00Z', until: '2026-11-21T00:00:00Z' },
  { code: 'EMBRACEPAIN', mode: 'pvp-season', from: '2026-11-07T12:00:00Z', until: '2026-11-21T00:00:00Z' },
]

/** `pvp-season`: a code for PvP and the PvP season both. */
export type PromoMode = 'pvp' | 'pve' | 'season' | 'pvp-season'
export interface FoundPromoCode { code: string; mode?: PromoMode; /** Shown at least until then (ms): a channel's code, two weeks from its post. */ until?: number }

/**
 * Telegram channels that post the studio's new codes as they come out (owner, 18.11.2026: «Найди ресурс «Тарковское
 * метадвижение», они постоянно выкладывают свежие промокоды»; its post of 17.11 had READ80LV a day before any page). The
 * server cannot reach Telegram itself, so a channel is read through its public RSS mirror. A code a channel posts is taken
 * at once — no second page needed — and shown for CHANNEL_CODE_DAYS from the post.
 */
export interface PromoChannel { id: string; url: string }
export const PROMO_CHANNELS: readonly PromoChannel[] = [
  { id: 'metadvij', url: 'https://tg.i-c-a.su/rss/metadvij' },
]
export const CHANNEL_CODE_DAYS = 14

/** Capitals and digits, as the game's codes are; not a word every such page has in capitals. */
const CODE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/
const NOT_CODES = new Set(['PVP', 'PVE', 'EFT', 'FREE', 'NEW', 'CODE', 'CODES', 'COPY', 'NOTE', 'TIP', 'BSG', 'FAQ', 'USD', 'RUB', 'SPT', 'ZONE', 'SEASON', 'ALL', 'PROMO', 'AND', 'THE', 'NOVEMBER', 'KORD', 'BREACH'])

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim()

function modeOf(text: string): PromoMode | undefined {
  if (/\bpve\b/i.test(text)) return 'pve'
  if (/season|сезон/i.test(text)) return 'season'
  if (/\bpvp\b/i.test(text)) return 'pvp'
  return undefined
}

/** The page's active codes: list items that start with a code in bold, table rows that start with one, in the part between the headings. */
export function parsePromoPage(html: string, source: Pick<PromoSource, 'from' | 'to' | 'until'>): FoundPromoCode[] {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const headings = [...body.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match) => ({ at: match.index, end: match.index + match[0].length, text: plain(match[2]!) }))
  const start = headings.find((heading) => source.from.test(heading.text))
  if (!start) return []
  const end = headings.find((heading) => heading.at > start.at && source.to.test(heading.text))
  const whole = body.slice(start.end, end?.at ?? body.length)
  const stop = source.until ? whole.search(source.until) : -1
  const part = stop >= 0 ? whole.slice(0, stop) : whole
  const inner = headings.filter((heading) => heading.at > start.at && (!end || heading.at < end.at))
  const found = new Map<string, FoundPromoCode>()
  const add = (raw: string, at: number, after: string) => {
    const code = plain(raw)
    if (!CODE.test(code) || NOT_CODES.has(code) || !/[A-Z]/.test(code)) return
    // The mode: said beside the code («[PvP Zone]»), else by the sub-heading it stands under.
    const under = [...inner].reverse().find((heading) => heading.at - start.end <= at)
    const mode = modeOf(plain(after)) ?? (under ? modeOf(under.text) : undefined)
    if (!found.has(code)) found.set(code, { code, ...(mode ? { mode } : {}) })
  }
  for (const match of part.matchAll(/<li[^>]*>\s*(?:<p[^>]*>\s*)?(?:<(?:em|i)[^>]*>\s*)?<(?:strong|b|code)[^>]*>([\s\S]*?)<\/(?:strong|b|code)>([\s\S]*?)<\/li>/gi)) add(match[1]!, match.index, match[2]!)
  for (const match of part.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>([\s\S]*?)<\/tr>/gi)) add(match[1]!, match.index, match[2]!)
  return [...found.values()]
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => name[0] === '#'
  ? String.fromCodePoint(name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)))
  : ENTITY[name.toLowerCase()] ?? whole)

/**
 * A channel's RSS: the codes of its posts about codes from the last CHANNEL_CODE_DAYS — each one after a 🎁 («🎁 READ80LV»)
 * or in <code>; the mode as the post says it («только для PvE-режима»).
 */
export function parseChannelFeed(xml: string, now: number): FoundPromoCode[] {
  const found = new Map<string, FoundPromoCode>()
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const raw = item!.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? ''
    const html = decode(raw.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, ''))
    const text = decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|blockquote)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    if (!/промо|promo/i.test(text)) continue
    const posted = Date.parse(item!.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? '')
    if (!Number.isFinite(posted) || posted < now - CHANNEL_CODE_DAYS * DAY || posted > now + DAY) continue
    const words = [
      ...[...text.matchAll(/🎁([^\n]*)/gu)].flatMap((match) => match[1]!.split(/[\s,;/|]+/)),
      ...[...html.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/gi)].map((match) => plain(match[1]!)),
    ]
    const mode = modeOf(text)
    for (const word of words) {
      const code = word.trim()
      if (!CODE.test(code) || NOT_CODES.has(code) || !/[A-Z]/.test(code) || found.has(code)) continue
      found.set(code, { code, ...(mode ? { mode } : {}), until: posted + CHANNEL_CODE_DAYS * DAY })
    }
  }
  return [...found.values()]
}

/** Codes at least two pages list; the mode is the one the pages say most. */
export function agreedPromoCodes(pages: ReadonlyArray<readonly FoundPromoCode[]>, atLeast = 2): FoundPromoCode[] {
  const seen = new Map<string, { pages: number; modes: Map<PromoMode, number> }>()
  for (const page of pages) {
    for (const { code, mode } of page) {
      const row = seen.get(code) ?? { pages: 0, modes: new Map() }
      row.pages += 1
      if (mode) row.modes.set(mode, (row.modes.get(mode) ?? 0) + 1)
      seen.set(code, row)
    }
  }
  return [...seen].filter(([, row]) => row.pages >= atLeast).map(([code, row]) => {
    const mode = [...row.modes].sort((a, b) => b[1] - a[1])[0]?.[0]
    return { code, ...(mode ? { mode } : {}) }
  })
}

export interface PromoCodeView { code: string; mode?: PromoMode; addedAt: string; first?: boolean }

const DAY = 24 * 60 * 60 * 1000

export class PromoCodeStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS promo_codes (
      code TEXT PRIMARY KEY, mode TEXT, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, first_batch INTEGER NOT NULL DEFAULT 0
    )`)
  }

  /** What one check found; the codes new to the list. The very first check's codes are marked: no player is told of them as news. */
  update(codes: readonly FoundPromoCode[]): string[] {
    const at = this.now()
    const empty = Number((this.db.prepare('SELECT COUNT(*) AS n FROM promo_codes').get() as { n: number }).n) === 0
    const added: string[] = []
    for (const { code, mode, until } of codes) {
      // seen now; a channel's code (or one added by hand) stays to its own date
      const seen = Math.max(at, until ?? 0)
      const known = this.db.prepare('SELECT code FROM promo_codes WHERE code = ?').get(code)
      if (known) this.db.prepare('UPDATE promo_codes SET last_seen_at = MAX(last_seen_at, ?), mode = COALESCE(?, mode) WHERE code = ?').run(seen, mode ?? null, code)
      else {
        this.db.prepare('INSERT INTO promo_codes (code, mode, first_seen_at, last_seen_at, first_batch) VALUES (?, ?, ?, ?, ?)').run(code, mode ?? null, at, seen, empty ? 1 : 0)
        added.push(code)
      }
    }
    return added
  }

  /** Every code ever added, and the studio's own codes (ANNOUNCED_PROMO_CODES): the newest first. Nothing is taken off. */
  list(announced: readonly AnnouncedPromoCode[] = ANNOUNCED_PROMO_CODES): PromoCodeView[] {
    const now = this.now()
    const rows = this.db.prepare('SELECT code, mode, first_seen_at, first_batch FROM promo_codes ORDER BY first_seen_at DESC, code').all() as Array<{ code: string; mode: PromoMode | null; first_seen_at: number; first_batch: number }>
    const listed: PromoCodeView[] = rows.map((row) => ({ code: row.code, ...(row.mode ? { mode: row.mode } : {}), addedAt: new Date(row.first_seen_at).toISOString(), ...(row.first_batch ? { first: true } : {}) }))
    const known = new Set(listed.map((row) => row.code))
    const own = announced.filter((entry) => !known.has(entry.code) && Date.parse(entry.from) <= now)
      .map((entry): PromoCodeView => ({ code: entry.code, mode: entry.mode, addedAt: new Date(entry.from).toISOString() }))
    // the studio's own code keeps its mode («PvP и Сезон») when a page lists it under one mode only
    const studio = new Map(announced.map((entry) => [entry.code, entry]))
    return [...own, ...listed.map((row) => {
      const entry = studio.get(row.code)
      return entry ? { ...row, mode: entry.mode, addedAt: new Date(Math.min(Date.parse(entry.from), Date.parse(row.addedAt))).toISOString() } : row
    })]
      .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt) || a.code.localeCompare(b.code))
  }
}

export const PROMO_CHECK_MS = 2 * 60 * 60 * 1000

/**
 * One check: every page and every channel; one that fails counts as no answer. The pages' codes need two pages, fewer
 * than two answers take none of theirs; a channel's codes count on their own. New codes are told at once.
 */
export async function checkPromoCodes(store: PromoCodeStore, options: { fetch?: typeof fetch; sources?: readonly PromoSource[]; channels?: readonly PromoChannel[]; onNew?: (codes: string[]) => void; log?: (line: string) => void } = {}) {
  const sources = options.sources ?? PROMO_SOURCES
  const channels = options.channels ?? PROMO_CHANNELS
  const ask = options.fetch ?? fetch
  const posted = (await Promise.all(channels.map(async (channel) => {
    try {
      const response = await ask(channel.url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; RaidOS/1.0)', accept: 'application/rss+xml, text/xml' }, signal: AbortSignal.timeout(30_000) })
      if (!response.ok) { options.log?.(`promo codes: ${channel.id} ${response.status}`); return [] }
      return parseChannelFeed(await response.text(), Date.now())
    } catch (error) {
      options.log?.(`promo codes: ${channel.id} ${String(error).slice(0, 80)}`)
      return []
    }
  }))).flat()
  const pages = await Promise.all(sources.map(async (source) => {
    try {
      const response = await ask(source.url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; RaidOS/1.0)', accept: 'text/html' }, signal: AbortSignal.timeout(30_000) })
      if (!response.ok) { options.log?.(`promo codes: ${source.id} ${response.status}`); return null }
      const codes = parsePromoPage(await response.text(), source)
      if (!codes.length) options.log?.(`promo codes: ${source.id} lists none`)
      return codes.length ? codes : null
    } catch (error) {
      options.log?.(`promo codes: ${source.id} ${String(error).slice(0, 80)}`)
      return null
    }
  }))
  const answered = pages.filter((page): page is FoundPromoCode[] => page !== null)
  const agreed = answered.length >= 2 ? agreedPromoCodes(answered) : []
  // a code both a channel and the pages have: the pages' mode when they say one, the channel's date
  const codes = new Map(agreed.map((entry) => [entry.code, entry]))
  for (const entry of posted) {
    const page = codes.get(entry.code)
    codes.set(entry.code, page ? { ...entry, ...page, ...(entry.until ? { until: entry.until } : {}) } : entry)
  }
  if (!codes.size) return { answered: answered.length, added: [] as string[] }
  const added = store.update([...codes.values()])
  if (added.length) options.onNew?.(added)
  return { answered: answered.length, added }
}
