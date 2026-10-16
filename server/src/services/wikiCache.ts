import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fetchWikiQuestSync, type WikiQuestSync } from '../../../src/data/wikiQuestCatalog'
import { writeFileAtomic } from './atomicFile.js'

/** A wiki answer younger than this is used as it is: the quest base builds reach the wiki about twice a day. */
export const WIKI_CACHE_MS = 12 * 60 * 60_000
/** The longest a build waits for the wiki (its own requests time out one by one, which can add up to many minutes). */
export const WIKI_BUDGET_MS = 3 * 60_000

export interface WikiCacheStatus {
  /**
   * `fetched`: read from the wiki for this build; `cached`: the stored answer is younger than WIKI_CACHE_MS; `stale`: the
   * wiki failed and the older stored answer was used; `failed`: the wiki failed and nothing was stored (the build then
   * keeps tarkov.dev's texts and the curated story chapters, as without the wiki); `idle`: not asked yet.
   */
  state: 'fetched' | 'cached' | 'stale' | 'failed' | 'idle'
  /** When the answer in use was read from the wiki. */
  fetchedAt?: string
  /** The last time the wiki itself was asked. */
  attemptedAt?: string
  error?: string
  titles: number
  pages: number
  storyChapters: number
}

export interface WikiCacheOptions {
  /** The stored answer (JSON); none: memory only. */
  file?: string
  maxAgeMs?: number
  budgetMs?: number
  fetch?: () => Promise<WikiQuestSync>
  now?: () => number
  log?: (message: string) => void
}

const EMPTY: WikiQuestSync = { titles: [], pages: [], storyQuests: [] }

/** An answer worth keeping: the quest pages came (the titles, which they need, came too). */
function usable(sync: WikiQuestSync | undefined): sync is WikiQuestSync {
  return Boolean(sync && Array.isArray(sync.titles) && Array.isArray(sync.pages) && Array.isArray(sync.storyQuests) && sync.pages.length > 0)
}

function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${Math.round(ms / 1000)} s`)), ms)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * The Russian fandom wiki for the quest base (quest pages, titles and story chapters, src/data/wikiQuestCatalog.ts),
 * kept on disk with the time it was read. Only the scheduled builds ask for it; the wiki is reached at most once per
 * WIKI_CACHE_MS, and a failing or slow wiki never fails a build: the stored answer is used, however old, or none.
 */
export class WikiCache {
  private stored?: { fetchedAt: number; sync: WikiQuestSync }
  private diskRead = false
  private inflight?: Promise<WikiQuestSync>
  private current: WikiCacheStatus = { state: 'idle', titles: 0, pages: 0, storyChapters: 0 }

  constructor(private readonly options: WikiCacheOptions = {}) {}

  status(): WikiCacheStatus { return { ...this.current } }

  load(): Promise<WikiQuestSync> {
    this.inflight ??= this.loadOnce().finally(() => { this.inflight = undefined })
    return this.inflight
  }

  private now() { return this.options.now?.() ?? Date.now() }

  private async loadOnce(): Promise<WikiQuestSync> {
    await this.readStored()
    const now = this.now()
    if (this.stored && now - this.stored.fetchedAt < (this.options.maxAgeMs ?? WIKI_CACHE_MS)) {
      this.current = this.describe('cached', this.stored)
      return this.stored.sync
    }
    let fresh: WikiQuestSync | undefined
    let error: string | undefined
    try {
      fresh = await withBudget((this.options.fetch ?? fetchWikiQuestSync)(), this.options.budgetMs ?? WIKI_BUDGET_MS)
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
    }
    const attemptedAt = new Date(now).toISOString()
    if (usable(fresh)) {
      this.stored = { fetchedAt: now, sync: fresh }
      this.current = { ...this.describe('fetched', this.stored), attemptedAt }
      const file = this.options.file
      if (file) {
        await mkdir(dirname(file), { recursive: true })
          .then(() => writeFileAtomic(file, JSON.stringify({ format: 1, fetchedAt: attemptedAt, data: fresh })))
          .catch((reason: unknown) => this.options.log?.(`wiki cache: not saved (${reason instanceof Error ? reason.message : 'write failed'})`))
      }
      return fresh
    }
    error ??= 'no quest pages in the answer'
    if (this.stored) {
      this.current = { ...this.describe('stale', this.stored), attemptedAt, error }
      return this.stored.sync
    }
    const answer = fresh ?? EMPTY
    this.current = { state: 'failed', attemptedAt, error, titles: answer.titles?.length ?? 0, pages: answer.pages?.length ?? 0, storyChapters: answer.storyQuests?.length ?? 0 }
    return answer
  }

  private describe(state: WikiCacheStatus['state'], stored: { fetchedAt: number; sync: WikiQuestSync }): WikiCacheStatus {
    return { state, fetchedAt: new Date(stored.fetchedAt).toISOString(), titles: stored.sync.titles.length, pages: stored.sync.pages.length, storyChapters: stored.sync.storyQuests.length }
  }

  /** The answer stored by an earlier run of the server, read once. */
  private async readStored() {
    if (this.diskRead || !this.options.file) return
    this.diskRead = true
    try {
      const value = JSON.parse(await readFile(this.options.file, 'utf8')) as { format?: unknown; fetchedAt?: unknown; data?: WikiQuestSync }
      const fetchedAt = typeof value.fetchedAt === 'string' ? Date.parse(value.fetchedAt) : Number.NaN
      if (value.format === 1 && Number.isFinite(fetchedAt) && usable(value.data)) this.stored = { fetchedAt, sync: value.data }
      else this.options.log?.('wiki cache: the stored answer is not usable, the wiki is asked again')
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') this.options.log?.(`wiki cache: the stored answer is not readable (${reason instanceof Error ? reason.message : 'error'})`)
    }
  }
}
