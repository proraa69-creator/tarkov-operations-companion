import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { WikiQuestSync } from '../../../src/data/wikiQuestCatalog'
import { WIKI_CACHE_MS, WikiCache } from './wikiCache.js'

const START = Date.parse('2026-10-14T10:00:00.000Z')
const page = (title: string) => ({ title, description: '', trader: '', locationMaps: [], objectives: [], rewards: [], previousTitles: [], nextTitles: [], stages: [] })
const answer = (pages: number): WikiQuestSync => ({ titles: ['Дефицит'], pages: Array.from({ length: pages }, (_, index) => page(`Страница ${index}`)), storyQuests: [] })

test('wiki cache: the wiki is read at most once per 12 hours, kept on disk with its time; a failing or slow wiki uses the stored answer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
  const dir = await mkdtemp(join(tmpdir(), 'raidos-wiki-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'quest-base', 'wiki.json')
  let next: () => Promise<WikiQuestSync> = async () => answer(2)
  let calls = 0
  const cache = new WikiCache({ file, budgetMs: 1000, fetch: () => { calls += 1; return next() } })
  assert.equal((await cache.load()).pages.length, 2)
  assert.deepEqual(cache.status(), { state: 'fetched', fetchedAt: new Date(START).toISOString(), attemptedAt: new Date(START).toISOString(), titles: 1, pages: 2, storyChapters: 0 })
  const stored = JSON.parse(await readFile(file, 'utf8')) as { format: number; fetchedAt: string; data: WikiQuestSync }
  assert.equal(stored.fetchedAt, new Date(START).toISOString())
  assert.equal(stored.data.pages.length, 2)

  // Within 12 hours the builds take the stored answer.
  t.mock.timers.tick(WIKI_CACHE_MS - 1)
  assert.equal((await cache.load()).pages.length, 2)
  assert.equal(calls, 1)
  assert.equal(cache.status().state, 'cached')

  // Later the wiki answers without quest pages: the stored answer, however old, and the build goes on.
  t.mock.timers.tick(1)
  next = async () => ({ titles: [], pages: [], storyQuests: [] })
  assert.equal((await cache.load()).pages.length, 2)
  assert.equal(calls, 2)
  assert.deepEqual({ state: cache.status().state, fetchedAt: cache.status().fetchedAt, error: cache.status().error }, { state: 'stale', fetchedAt: new Date(START).toISOString(), error: 'no quest pages in the answer' })

  // A wiki that never answers: the budget ends the wait.
  next = () => new Promise<WikiQuestSync>(() => undefined)
  const waiting = cache.load()
  await new Promise((resolve) => setImmediate(resolve))
  t.mock.timers.tick(1000)
  assert.equal((await waiting).pages.length, 2)
  assert.match(cache.status().error ?? '', /no answer within 1 s/)

  // A new server process reads the stored answer from disk; a fresh wiki answer replaces it.
  next = async () => answer(3)
  const restarted = new WikiCache({ file, fetch: () => next() })
  assert.equal((await restarted.load()).pages.length, 3)
  assert.equal(restarted.status().state, 'fetched')
  assert.equal((JSON.parse(await readFile(file, 'utf8')) as { data: WikiQuestSync }).data.pages.length, 3)
  const third = new WikiCache({ file, fetch: async () => { throw new Error('not asked within 12 hours') } })
  assert.equal((await third.load()).pages.length, 3)
  assert.equal(third.status().state, 'cached')
})

test('wiki cache: nothing stored and the wiki down: an empty answer (the build keeps its fallback), state failed', async () => {
  const cache = new WikiCache({ fetch: async () => { throw new Error('HTTP 503') } })
  assert.deepEqual(await cache.load(), { titles: [], pages: [], storyQuests: [] })
  assert.equal(cache.status().state, 'failed')
  assert.equal(cache.status().error, 'HTTP 503')
})
