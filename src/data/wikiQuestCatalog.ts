import type { Quest } from '../domain/types'
import {
  mergeStoryChapters,
  mergeWikiQuestDetails,
  normalizeQuestKey,
  parseStoryIndex,
  parseWikiQuestPage,
  storyQuestFromPage,
  type WikiQuestPage,
} from './wikiQuestParse'

export { normalizeQuestKey, mergeStoryChapters, mergeWikiQuestDetails }

const WIKI_API = 'https://escapefromtarkov.fandom.com/ru/api.php'
const SKIP_TITLE = /^(категория:|шаблон:|список |квесты$|главы истории$)/i
const STORY_INDEX_TITLE = 'Главы истории'

export interface WikiQuestSync {
  titles: string[]
  pages: WikiQuestPage[]
  storyQuests: Quest[]
}

export function mergeWikiQuestCatalog(quests: Quest[], wikiTitles: string[]): Quest[] {
  const merged = quests.map((quest) => ({ ...quest }))
  const byKey = new Map<string, Quest>()
  for (const quest of merged) {
    byKey.set(normalizeQuestKey(quest.name), quest)
    if (quest.normalizedName) byKey.set(normalizeQuestKey(quest.normalizedName), quest)
  }

  for (const title of wikiTitles) {
    if (!title || SKIP_TITLE.test(title)) continue
    const key = normalizeQuestKey(title)
    if (!key) continue
    const wikiLink = `https://escapefromtarkov.fandom.com/ru/wiki/${encodeURIComponent(title)}`
    const existing = byKey.get(key)
      ?? [...byKey.entries()].find(([entry]) => entry.includes(key) || key.includes(entry) && Math.min(entry.length, key.length) >= 8)?.[1]
    if (existing) existing.wikiLink = existing.wikiLink || wikiLink
  }
  return merged
}

export async function fetchWikiQuestSync(): Promise<WikiQuestSync> {
  const [titles, storyQuests] = await Promise.all([
    fetchWikiQuestTitles().catch(() => [] as string[]),
    fetchStoryChapters().catch(() => [] as Quest[]),
  ])
  const storyKeys = new Set(storyQuests.map((quest) => normalizeQuestKey(quest.name)))
  const detailTitles = titles.filter((title) => !SKIP_TITLE.test(title) && !storyKeys.has(normalizeQuestKey(title)))
  const pages = await withTimeout(fetchWikiPages(detailTitles), 45_000, [] as WikiQuestPage[])
  return { titles, pages, storyQuests }
}

export async function fetchWikiQuestTitles(): Promise<string[]> {
  const categories = ['Категория:Квесты']
  const seen = new Set(categories)
  const titles: string[] = []
  for (const category of categories) {
    const subcats = await fetchCategoryMembers(category, 'subcat')
    for (const subcat of subcats) {
      if (seen.has(subcat) || seen.size >= 20) continue
      seen.add(subcat)
      categories.push(subcat)
    }
    titles.push(...await fetchCategoryMembers(category, 'page'))
  }
  return [...new Set(titles)]
}

async function fetchCategoryMembers(category: string, type: 'page' | 'subcat') {
  const titles: string[] = []
  let continueToken = ''
  for (let page = 0; page < 6; page += 1) {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: category,
      cmlimit: '500',
      cmtype: type,
      format: 'json',
      origin: '*',
    })
    if (continueToken) params.set('cmcontinue', continueToken)
    const payload = await wikiQuery(params)
    titles.push(...(payload.query?.categorymembers ?? []).map((entry) => entry.title ?? '').filter(Boolean))
    continueToken = payload.continue?.cmcontinue ?? ''
    if (!continueToken) break
  }
  return titles
}

async function fetchStoryChapters(): Promise<Quest[]> {
  const raw = await fetchWikiWikitext(STORY_INDEX_TITLE)
  const rows = parseStoryIndex(raw)
  if (!rows.length) return []
  const chapterPages = await fetchWikiPages(rows.map((row) => row.title))
  return rows.map((row) => {
    const page = chapterPages.find((entry) => normalizeQuestKey(entry.title) === normalizeQuestKey(row.title))
      ?? parseWikiQuestPage(row.title, '')
    return storyQuestFromPage(page, row.order, row.english)
  })
}

async function fetchWikiPages(titles: string[]): Promise<WikiQuestPage[]> {
  const pages: WikiQuestPage[] = []
  const uniqueTitles = [...new Set(titles.filter(Boolean))]
  for (let index = 0; index < uniqueTitles.length; index += 40) {
    const chunk = uniqueTitles.slice(index, index + 40)
    const params = new URLSearchParams({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      format: 'json',
      origin: '*',
      redirects: '1',
      titles: chunk.join('|'),
    })
    const payload = await wikiQuery(params)
    for (const page of Object.values(payload.query?.pages ?? {})) {
      const text = revisionText(page)
      if (!page.title || !text) continue
      pages.push(parseWikiQuestPage(page.title, text))
    }
  }
  return pages
}

async function fetchWikiWikitext(title: string) {
  const params = new URLSearchParams({
    action: 'parse',
    page: title,
    prop: 'wikitext',
    format: 'json',
    origin: '*',
  })
  const response = await fetch(`${WIKI_API}?${params.toString()}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) return ''
  const payload = await response.json() as { parse?: { wikitext?: { '*'?: string } } }
  return payload.parse?.wikitext?.['*'] ?? ''
}

async function wikiQuery(params: URLSearchParams) {
  const response = await fetch(`${WIKI_API}?${params.toString()}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Wiki HTTP ${response.status}`)
  return await response.json() as {
    continue?: { cmcontinue?: string }
    query?: {
      categorymembers?: Array<{ title?: string }>
      pages?: Record<string, WikiRevisionPage>
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T) {
  return await Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      globalThis.setTimeout(() => resolve(fallback), ms)
    }),
  ])
}

function revisionText(page: WikiRevisionPage) {
  const revision = page.revisions?.[0]
  return revision?.slots?.main?.['*'] ?? revision?.['*'] ?? ''
}

interface WikiRevisionPage {
  title?: string
  revisions?: Array<{ '*'?: string; slots?: { main?: { '*'?: string } } }>
}
