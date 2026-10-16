import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppDataset, Quest, RaidMode } from '../../../src/domain/types'
import { storyChapterTitles } from '../../../src/data/storyChapters'
import { STORY_CHAPTER_SEEDS, TOUR_STAGE_POINTS } from '../../../src/data/storyChapterSeeds'
import { STORY_QUEST_INDEX } from '../../../src/data/storyQuestIndex'
import { normalizeQuestKey } from '../../../src/data/wikiQuestParse'
import { TEMPORARY_SUFFIX, writeFileAtomic } from './atomicFile.js'
import { CATALOG_RETRY_MS, hashWithoutLoadedAt, isUsableCatalog, type CatalogLocale } from './catalogCache.js'

/**
 * «Одна общая база квестов» (owner, 14.10.2026: «скачать всю базу квестов, сохранить на сервере и составить одну общую
 * базу квестов и полагаться на нее»). The server keeps one versioned quest base per game mode on disk: the catalog of the
 * mode in Russian and in English, built by the app's own code (src/data/catalogSource.ts) from the tarkov.dev mirror, the
 * Russian wiki (services/wikiCache.ts), the tarkov.help guides and the story chapters of the app.
 * - Built on a schedule, never per request: at start only when the mode has no snapshot on disk or it is older than the
 *   period, then every period (30 minutes), and shortly after the tarkov.dev mirror publishes new data. One build at a
 *   time, the modes one after another and each language after the other, so only one catalog is being built at once.
 *   A request starts a build only when its mode has no snapshot at all (the very first start).
 * - The acceptance rules of the old per-request cache stay: only a usable catalog (quests, maps, items) of the right
 *   mode replaces the base; otherwise the last good one stays and the build is tried again after 1, 2, 5, then 15 minutes.
 * - Every accepted version is written atomically (`<lang>-<version>.json`, then `manifest.json` naming them) and read
 *   back at the next start at once, so a restart never makes a player wait for a build.
 * - Both snapshots of a mode carry `nameRu` and `nameEn` on every quest, trader quests and story chapters alike, and
 *   `ocrAliases`: the chapter's other names and the earlier titles of the same id (renames, kept in the manifest). The
 *   screen reader, the log reset filter, coverage and inference all see the same ids and titles in either language.
 * - The version is a content hash of the two snapshots without their build time (`metadata.questBaseVersion` of every
 *   served catalog); the manifest keeps the sources, the counts and what changed since the previous version (the
 *   owner's GET /v1/accounts/me/admin/quest-base, routes/questBase.ts).
 * PvP, PvE and Season never mix: the mode names the folder, the manifest and every snapshot, and each is checked.
 */
export const QUEST_BASE_MODES: readonly RaidMode[] = ['pvp', 'pve', 'seasonal']
export const QUEST_BASE_PERIOD_MS = 30 * 60_000
/** The data mirror publishes the three modes one after another: one build after the last of them. */
export const QUEST_BASE_MIRROR_DEBOUNCE_MS = 60_000
const LOCALES: readonly CatalogLocale[] = ['ru', 'en']
const MANIFEST = 'manifest.json'
const VERSION = /^[a-f0-9]{16}$/
const SNAPSHOT_FILE = /^(?:ru|en)-[a-f0-9]{16}\.json$/
const CYRILLIC = /[А-Яа-яЁё]/
/** An untranslated tarkov.dev text is its translation key («<task id> name»), not a title. */
const TRANSLATION_KEY = /^[0-9a-f]{24}(?:\s|$)/i

/** The period from RAIDOS_QUEST_BASE_MINUTES (5 minutes to a day); 30 minutes when unset or not a number. */
export function questBasePeriodMs(minutes: string | undefined) {
  const value = Number(minutes)
  return Number.isFinite(value) && value > 0 ? Math.round(Math.min(24 * 60, Math.max(5, value)) * 60_000) : QUEST_BASE_PERIOD_MS
}

export interface QuestTitles { ru?: string; en?: string }
export interface QuestRename { lang: CatalogLocale; from: string; to: string; at: string; version: string }
export interface QuestBaseChange { id: string; ru?: string; en?: string }
export interface QuestBaseChanges {
  /** The version these changes lead from; null for the first version. */
  since: string | null
  added: QuestBaseChange[]
  removed: QuestBaseChange[]
  renamed: Array<{ id: string; lang: CatalogLocale; from: string; to: string }>
}
export interface QuestBaseAppVersion { version?: string; build?: number; commit?: string }
export interface QuestBaseSources {
  /** The tarkov.dev data: the mirror generation and the version of its tasks file. */
  tarkovDev?: Record<string, unknown>
  /** The wiki cache's state for this build (services/wikiCache.ts). */
  wiki?: Record<string, unknown>
  /** «Оружейник» guides in the Russian snapshot: tarkov.help's, the wiki's tables, and a hash of tarkov.help's. */
  tarkovHelp: { guides: number; wikiGuides: number; hash: string }
  /** The story chapters come from the app: its build, and a hash of the chapter seeds it carries. */
  story: { seeds: string; app?: QuestBaseAppVersion }
}
export interface QuestBaseManifest {
  format: 1
  mode: RaidMode
  version: string
  /** When this version was built first. */
  builtAt: string
  /** The last build that confirmed it (a build that finds nothing new keeps the version and its snapshots). */
  checkedAt: string
  /** Each snapshot: its file, its size and the SHA-256 of its JSON without `metadata.loadedAt`. */
  files: Record<CatalogLocale, { file: string; bytes: number; hash: string }>
  sources: QuestBaseSources
  counts: Record<string, number>
  /** Titles of every quest of this version by id. */
  titles: Record<string, QuestTitles>
  /** Every title change of a quest id over the versions (its `from` titles are the quest's OCR aliases). */
  renames: Record<string, QuestRename[]>
  changes: QuestBaseChanges
}

export interface QuestBaseModeReport {
  version: string | null
  builtAt: string | null
  checkedAt: string | null
  sources: QuestBaseSources | null
  counts: Record<string, number>
  changes: QuestBaseChanges | null
  /** Quests with an earlier title. */
  renamedQuests: number
  state: { building: boolean; failures: number; lastError: string | null; lastAttemptAt: string | null; lastBuildMs: number | null; nextBuildAt: string | null; savedToDisk: boolean }
}
export interface QuestBaseReport { periodMinutes: number; modes: Record<RaidMode, QuestBaseModeReport> }

export interface QuestBaseOptions {
  /** Folder of the snapshots, one sub-folder per mode; none: memory only (development, tests). */
  dir?: string
  /** Builds the catalog of a mode in a language (the server: fetchLiveCatalog on the mirror, services/catalogService.ts). */
  load: (mode: RaidMode, locale: CatalogLocale) => Promise<AppDataset>
  /** The state of the outside sources after a build of the mode (the mirror generation, the wiki cache). */
  sources?: (mode: RaidMode) => Promise<Pick<QuestBaseSources, 'tarkovDev' | 'wiki'>>
  /** The app build that carries the story chapters (TARKOV_APP_*). */
  app?: QuestBaseAppVersion
  periodMs?: number
  mirrorDebounceMs?: number
  now?: () => number
  log?: (message: string) => void
}

interface Snapshot { ru: AppDataset; en: AppDataset; manifest: QuestBaseManifest }
interface ModeState {
  current?: Snapshot
  /** When the next build of the mode is due (Infinity: none planned). */
  due: number
  /** Counts the triggers (the mirror) — one that comes during a build asks for another build right after it. */
  triggers: number
  building: boolean
  failures: number
  lastError?: string
  lastAttemptAt?: number
  /** How long the last successful build of both languages took. */
  lastBuildMs?: number
  saved: boolean
  /** Requests waiting for the first snapshot of the mode. */
  waiters: Array<{ resolve: () => void; reject: (error: Error) => void }>
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300)
const shortHash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16)
const versionOf = (ruHash: string, enHash: string) => createHash('sha256').update(`${ruHash}\n${enHash}`).digest('hex').slice(0, 16)
let seedsHash: string | undefined
const storySeedsHash = () => (seedsHash ??= shortHash(JSON.stringify([STORY_CHAPTER_SEEDS, TOUR_STAGE_POINTS, STORY_QUEST_INDEX])))

/** The same acceptance as the old per-request cache: a usable catalog of the asked mode, or an error. */
function accepted(mode: RaidMode, data: AppDataset | undefined): AppDataset {
  if (!isUsableCatalog(data)) throw new Error('Источник данных вернул пустой каталог')
  if (data.metadata?.mode && data.metadata.mode !== mode) throw new Error('Источник данных вернул каталог другого режима')
  return data
}

function gameTitle(value: string | undefined) {
  const title = value?.trim()
  return title && !TRANSLATION_KEY.test(title) ? title : undefined
}

/** tarkov.dev's English title; a Russian one (the English catalog keeps the curated Russian chapter names) is not. */
function englishTitle(value: string | undefined) {
  const title = gameTitle(value)
  return title && !CYRILLIC.test(title) ? title : undefined
}

function chapterOf(quest: Quest | undefined) {
  return quest?.kind === 'story' ? storyChapterTitles(quest) : undefined
}

/**
 * Both titles of every quest by id: a story chapter's from the app's chapter data, a trader quest's from each language's
 * catalog. A title this build lacks (an untranslated text) keeps the previous version's.
 */
function questTitles(ru: AppDataset, en: AppDataset, previous: Record<string, QuestTitles> = {}) {
  const russian = new Map(ru.quests.map((quest) => [quest.id, quest]))
  const english = new Map(en.quests.map((quest) => [quest.id, quest]))
  const titles: Record<string, QuestTitles> = {}
  for (const id of new Set([...russian.keys(), ...english.keys()])) {
    const chapter = chapterOf(russian.get(id)) ?? chapterOf(english.get(id))
    const ruTitle = chapter?.ru ?? gameTitle(russian.get(id)?.name) ?? previous[id]?.ru
    const enTitle = chapter?.en ?? englishTitle(english.get(id)?.name) ?? previous[id]?.en
    titles[id] = { ...(ruTitle ? { ru: ruTitle } : {}), ...(enTitle ? { en: enTitle } : {}) }
  }
  return titles
}

/** Title changes of the same id against the previous version (case, «ё» and punctuation do not count). */
function renamesOf(previous: Record<string, QuestTitles> | undefined, titles: Record<string, QuestTitles>) {
  const renamed: QuestBaseChanges['renamed'] = []
  if (!previous) return renamed
  for (const [id, title] of Object.entries(titles)) {
    for (const lang of LOCALES) {
      const from = previous[id]?.[lang]
      const to = title[lang]
      if (from && to && normalizeQuestKey(from) !== normalizeQuestKey(to)) renamed.push({ id, lang, from, to })
    }
  }
  return renamed
}

/** `nameRu`, `nameEn` and `ocrAliases` on every quest; an alias never repeats the quest's own titles. */
function withTitles(data: AppDataset, titles: Record<string, QuestTitles>, earlier: (id: string) => string[]): AppDataset {
  return {
    ...data,
    quests: data.quests.map((quest) => {
      const title = titles[quest.id] ?? {}
      const seen = new Set([quest.name, title.ru, title.en].filter((value): value is string => Boolean(value)).map(normalizeQuestKey))
      const aliases: string[] = []
      for (const alias of [...(quest.ocrAliases ?? []), ...(chapterOf(quest)?.aliases ?? []), ...earlier(quest.id)]) {
        const key = normalizeQuestKey(alias)
        if (!key || seen.has(key)) continue
        seen.add(key)
        aliases.push(alias)
      }
      const next: Quest = { ...quest }
      if (title.ru) next.nameRu = title.ru
      else delete next.nameRu
      if (title.en) next.nameEn = title.en
      else delete next.nameEn
      if (aliases.length) next.ocrAliases = aliases
      else delete next.ocrAliases
      return next
    }),
  }
}

function stamped(data: AppDataset, version: string): AppDataset {
  return { ...data, metadata: { ...data.metadata!, questBaseVersion: version } }
}

function countsOf(ru: AppDataset, en: AppDataset): Record<string, number> {
  const story = ru.quests.filter((quest) => quest.kind === 'story').length
  return {
    quests: ru.quests.length,
    traderQuests: ru.quests.length - story,
    storyChapters: story,
    kappa: ru.quests.filter((quest) => quest.kappa).length,
    englishQuests: en.quests.length,
    bothTitles: ru.quests.filter((quest) => quest.nameRu && quest.nameEn).length,
    ocrAliases: ru.quests.reduce((sum, quest) => sum + (quest.ocrAliases?.length ?? 0), 0),
    items: ru.items.length,
    maps: ru.maps.length,
    markers: ru.markers.length,
    traders: ru.traders.length,
    hideout: ru.hideout.length,
  }
}

function changesOf(previous: QuestBaseManifest | undefined, titles: Record<string, QuestTitles>, renamed: QuestBaseChanges['renamed']): QuestBaseChanges {
  if (!previous) return { since: null, added: [], removed: [], renamed: [] }
  const before = previous.titles
  return {
    since: previous.version,
    added: Object.keys(titles).filter((id) => !before[id]).map((id) => ({ id, ...titles[id] })),
    removed: Object.keys(before).filter((id) => !titles[id]).map((id) => ({ id, ...before[id] })),
    renamed,
  }
}

function parseManifest(value: unknown, mode: RaidMode): QuestBaseManifest {
  const row = (value && typeof value === 'object' ? value : {}) as Partial<QuestBaseManifest>
  const fileOk = (locale: CatalogLocale) => {
    const entry = row.files?.[locale]
    return Boolean(entry && typeof entry.file === 'string' && SNAPSHOT_FILE.test(entry.file) && entry.file.startsWith(`${locale}-`)
      && typeof entry.hash === 'string' && /^[a-f0-9]{64}$/.test(entry.hash))
  }
  if (row.format !== 1 || row.mode !== mode || typeof row.version !== 'string' || !VERSION.test(row.version)
    || typeof row.builtAt !== 'string' || typeof row.checkedAt !== 'string' || !fileOk('ru') || !fileOk('en')) {
    throw new Error('the manifest is not valid')
  }
  return {
    ...row,
    sources: row.sources ?? { tarkovHelp: { guides: 0, wikiGuides: 0, hash: '' }, story: { seeds: '' } },
    counts: row.counts ?? {},
    titles: row.titles && typeof row.titles === 'object' ? row.titles : {},
    renames: row.renames && typeof row.renames === 'object' ? row.renames : {},
    changes: row.changes ?? { since: null, added: [], removed: [], renamed: [] },
  } as QuestBaseManifest
}

export class QuestBase {
  private readonly states = new Map<RaidMode, ModeState>()
  private ready: Promise<void> = Promise.resolve()
  private started = false
  private stopped = false
  private timer?: ReturnType<typeof setTimeout>
  private mirrorTimer?: ReturnType<typeof setTimeout>
  private readonly mirrorModes = new Set<RaidMode>()
  private running?: Promise<void>

  constructor(private readonly options: QuestBaseOptions) {
    for (const mode of QUEST_BASE_MODES) this.states.set(mode, { due: Number.POSITIVE_INFINITY, triggers: 0, building: false, failures: 0, saved: true, waiters: [] })
  }

  get periodMs() { return this.options.periodMs ?? QUEST_BASE_PERIOD_MS }

  /**
   * Reads the snapshots on disk at once, then builds the modes that have none or an older one than the period, and
   * keeps building every period. Requests wait for the disk only, never for a build (unless a mode has nothing at all).
   */
  start(): Promise<void> {
    if (this.started) return this.ready
    this.started = true
    this.stopped = false
    this.ready = this.loadAll().then(() => {
      const now = this.now()
      for (const state of this.states.values()) {
        const checked = state.current ? Date.parse(state.current.manifest.checkedAt) : Number.NaN
        const fresh = Number.isFinite(checked) && now - checked < this.periodMs
        state.due = Math.min(state.due, fresh ? Math.min(checked, now) + this.periodMs : now)
      }
      this.schedule()
    })
    return this.ready
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.mirrorTimer) clearTimeout(this.mirrorTimer)
    this.timer = this.mirrorTimer = undefined
  }

  /** Settles once no build is running. */
  async idle() {
    while (this.running) await this.running
  }

  /**
   * The snapshot of a mode in a language, answered at once from the base, however old. Only a mode without any snapshot
   * (the very first start, nothing on disk yet) waits: its build is started (or awaited) — unless it has just failed,
   * then the request fails with that error until the back-off is over.
   */
  async snapshot(mode: RaidMode, locale: CatalogLocale = 'ru'): Promise<AppDataset> {
    await this.ready
    const state = this.state(mode)
    if (!state.current) await this.firstSnapshot(mode, state)
    return state.current![locale]
  }

  /** The current snapshot without waiting (summaries); undefined while the mode has none. */
  peek(mode: RaidMode, locale: CatalogLocale = 'ru'): AppDataset | undefined {
    return this.state(mode).current?.[locale]
  }

  version(mode: RaidMode): string | undefined {
    return this.state(mode).current?.manifest.version
  }

  /** The tarkov.dev mirror published new data of these modes: they are built again once the mirror is quiet. */
  mirrorUpdated(modes: readonly RaidMode[] = QUEST_BASE_MODES) {
    if (this.stopped || !modes.length) return
    for (const mode of modes) this.mirrorModes.add(mode)
    if (this.mirrorTimer) clearTimeout(this.mirrorTimer)
    this.mirrorTimer = setTimeout(() => {
      this.mirrorTimer = undefined
      for (const mode of this.mirrorModes) {
        const state = this.state(mode)
        state.triggers += 1
        state.due = Math.min(state.due, this.now())
      }
      this.mirrorModes.clear()
      this.schedule()
    }, this.options.mirrorDebounceMs ?? QUEST_BASE_MIRROR_DEBOUNCE_MS)
    this.mirrorTimer.unref?.()
  }

  /**
   * The owner changed what a build adds (his event quests, routes/eventQuests.ts): every mode is built again once he
   * stops editing (the same quiet period as the mirror's, so a burst of edits makes one build).
   */
  contentChanged() {
    this.mirrorUpdated(QUEST_BASE_MODES)
  }

  /** The owner's view: per mode the version, its sources and counts, what changed, and the builder's state. */
  report(): QuestBaseReport {
    const iso = (value: number | undefined) => (value === undefined || !Number.isFinite(value) ? null : new Date(value).toISOString())
    const modes = {} as Record<RaidMode, QuestBaseModeReport>
    for (const mode of QUEST_BASE_MODES) {
      const state = this.state(mode)
      const manifest = state.current?.manifest
      modes[mode] = {
        version: manifest?.version ?? null,
        builtAt: manifest?.builtAt ?? null,
        checkedAt: manifest?.checkedAt ?? null,
        sources: manifest?.sources ?? null,
        counts: manifest?.counts ?? {},
        changes: manifest?.changes ?? null,
        renamedQuests: manifest ? Object.keys(manifest.renames).length : 0,
        state: {
          building: state.building,
          failures: state.failures,
          lastError: state.lastError ?? null,
          lastAttemptAt: iso(state.lastAttemptAt),
          lastBuildMs: state.lastBuildMs ?? null,
          nextBuildAt: this.stopped ? null : iso(state.due),
          savedToDisk: state.saved,
        },
      }
    }
    return { periodMinutes: Math.round(this.periodMs / 60_000), modes }
  }

  private now() { return this.options.now?.() ?? Date.now() }

  private log(message: string) { (this.options.log ?? console.log)(message) }

  private state(mode: RaidMode): ModeState {
    const state = this.states.get(mode)
    if (!state) throw new Error(`Неизвестный режим: ${mode}`)
    return state
  }

  private firstSnapshot(mode: RaidMode, state: ModeState) {
    if (state.failures > 0 && !state.building && this.now() < state.due) return Promise.reject(new Error(state.lastError ?? 'Каталог ещё не собран'))
    return new Promise<void>((resolve, reject) => {
      state.waiters.push({ resolve, reject })
      state.due = Math.min(state.due, this.now())
      this.schedule()
    })
  }

  private schedule() {
    if (this.stopped || this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const next = Math.min(...[...this.states.values()].map((state) => state.due))
    if (!Number.isFinite(next)) return
    const delay = Math.max(0, next - this.now())
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.run()
    }, delay)
    // A later build does not keep the process alive by itself; one due now (a request may wait for it) does.
    if (delay > 0) this.timer.unref?.()
  }

  /** One build at a time: the due modes one after another, then the timer for the next one. */
  private run() {
    if (this.running || this.stopped) return
    this.running = (async () => {
      for (let mode = this.nextDue(); mode; mode = this.nextDue()) await this.build(mode)
    })().finally(() => {
      this.running = undefined
      this.schedule()
    })
  }

  private nextDue(): RaidMode | undefined {
    if (this.stopped) return undefined
    const now = this.now()
    // The longest overdue first (the modes' order when due together), so no mode waits behind the others.
    const due = QUEST_BASE_MODES.filter((mode) => this.state(mode).due <= now).sort((a, b) => this.state(a).due - this.state(b).due)
    // A mode a request waits for (nothing to answer it with yet) goes first.
    return due.find((mode) => this.state(mode).waiters.length > 0) ?? due[0]
  }

  private async build(mode: RaidMode) {
    const state = this.state(mode)
    const started = this.now()
    const triggers = state.triggers
    state.building = true
    state.lastAttemptAt = started
    try {
      // The languages one after the other: one catalog in the making at a time.
      const ru = accepted(mode, await this.options.load(mode, 'ru'))
      const ruDone = this.now()
      const en = accepted(mode, await this.options.load(mode, 'en'))
      const enDone = this.now()
      // The sources' state is a description only: not knowing it never fails a build.
      const external = await Promise.resolve(this.options.sources?.(mode)).catch(() => undefined)
      const sources = this.sourcesOf(ru, external)
      const { changed, manifest } = await this.commit(mode, ru, en, sources)
      state.failures = 0
      state.lastError = undefined
      state.lastBuildMs = enDone - started
      state.due = state.triggers !== triggers ? this.now() : this.now() + this.periodMs
      this.settle(state)
      const changes = manifest.changes
      const what = changed ? `new version${changes.since ? ` (since ${changes.since}: +${changes.added.length} −${changes.removed.length} ~${changes.renamed.length})` : ''}` : 'unchanged'
      const wiki = sources.wiki && typeof sources.wiki.state === 'string' ? `, wiki ${sources.wiki.state}` : ''
      this.log(`quest base ${mode}: ${manifest.version} ${what}; ${manifest.counts.quests} quests, ${manifest.counts.bothTitles} with both titles; ru ${((ruDone - started) / 1000).toFixed(1)} s, en ${((enDone - ruDone) / 1000).toFixed(1)} s${wiki}${state.saved ? '' : '; not saved to disk'}`)
    } catch (error) {
      state.failures += 1
      state.lastError = describe(error)
      const retry = CATALOG_RETRY_MS[Math.min(state.failures, CATALOG_RETRY_MS.length) - 1]!
      state.due = state.triggers !== triggers ? this.now() : this.now() + retry
      this.settle(state, error)
      this.log(`quest base ${mode}: build failed (${state.lastError}); ${state.current ? `version ${state.current.manifest.version} stays` : 'no base yet'}, next try in ${Math.round(retry / 60_000)} min`)
    } finally {
      state.building = false
    }
  }

  private settle(state: ModeState, error?: unknown) {
    for (const waiter of state.waiters.splice(0)) {
      if (state.current) waiter.resolve()
      else waiter.reject(error instanceof Error ? error : new Error(describe(error ?? 'Каталог ещё не собран')))
    }
  }

  private sourcesOf(ru: AppDataset, external: Pick<QuestBaseSources, 'tarkovDev' | 'wiki'> | undefined): QuestBaseSources {
    const guides = ru.quests.flatMap((quest) => (quest.objectiveDetails ?? []).flatMap((objective) => (objective.build?.guide ? [objective.build.guide] : [])))
    const help = guides.filter((guide) => guide.source === 'tarkov.help')
    const tasksVersion = ru.metadata?.sourceVersion
    return {
      tarkovDev: { ...(tasksVersion ? { tasksVersion } : {}), ...external?.tarkovDev },
      ...(external?.wiki ? { wiki: external.wiki } : {}),
      tarkovHelp: { guides: help.length, wikiGuides: guides.length - help.length, hash: shortHash(JSON.stringify(help)) },
      story: { seeds: storySeedsHash(), ...(this.options.app ? { app: this.options.app } : {}) },
    }
  }

  /**
   * Titles, aliases and the version of a fresh build. The same content as the current version keeps the current
   * snapshots (and their build time); a new one replaces them in memory first, then on disk.
   */
  private async commit(mode: RaidMode, ruBuilt: AppDataset, enBuilt: AppDataset, sources: QuestBaseSources) {
    const state = this.state(mode)
    const previous = state.current?.manifest
    const at = new Date(this.now()).toISOString()
    const titles = questTitles(ruBuilt, enBuilt, previous?.titles)
    const renamed = renamesOf(previous?.titles, titles)
    const earlier = (id: string) => [...(previous?.renames[id] ?? []).map((entry) => entry.from), ...renamed.filter((entry) => entry.id === id).map((entry) => entry.from)]
    const ru = withTitles(ruBuilt, titles, earlier)
    const en = withTitles(enBuilt, titles, earlier)
    const texts: Record<CatalogLocale, string> = { ru: JSON.stringify(ru), en: JSON.stringify(en) }
    const hashes = { ru: hashWithoutLoadedAt(texts.ru, 'sha256'), en: hashWithoutLoadedAt(texts.en, 'sha256') }
    const version = versionOf(hashes.ru, hashes.en)
    const files = {
      ru: { file: `ru-${version}.json`, bytes: Buffer.byteLength(texts.ru), hash: hashes.ru },
      en: { file: `en-${version}.json`, bytes: Buffer.byteLength(texts.en), hash: hashes.en },
    }
    if (state.current && previous?.version === version) {
      // A snapshot that never reached the disk (a full disk) is written now; otherwise only the check is recorded.
      const manifest: QuestBaseManifest = { ...previous, checkedAt: at, sources, ...(state.saved ? {} : { files }) }
      state.current = { ...state.current, manifest }
      await this.save(mode, manifest, state.saved ? undefined : texts)
      return { changed: false, manifest }
    }
    const renames: Record<string, QuestRename[]> = { ...previous?.renames }
    for (const entry of renamed) renames[entry.id] = [...(renames[entry.id] ?? []), { lang: entry.lang, from: entry.from, to: entry.to, at, version }]
    const manifest: QuestBaseManifest = {
      format: 1, mode, version, builtAt: at, checkedAt: at, files, sources, counts: countsOf(ru, en), titles, renames,
      changes: changesOf(previous, titles, renamed),
    }
    // Served from memory at once, even if the disk write fails (it is tried again with the next build).
    state.current = { ru: stamped(ru, version), en: stamped(en, version), manifest }
    await this.save(mode, manifest, texts)
    return { changed: true, manifest }
  }

  /** The snapshots first, then the manifest naming them (the switch), then the files of older versions go. */
  private async save(mode: RaidMode, manifest: QuestBaseManifest, texts?: Record<CatalogLocale, string>) {
    const state = this.state(mode)
    if (!this.options.dir) return
    const dir = join(this.options.dir, mode)
    try {
      await mkdir(dir, { recursive: true })
      if (texts) for (const locale of LOCALES) await writeFileAtomic(join(dir, manifest.files[locale].file), texts[locale])
      await writeFileAtomic(join(dir, MANIFEST), JSON.stringify(manifest))
      state.saved = true
    } catch (error) {
      state.saved = false
      this.log(`quest base ${mode}: version ${manifest.version} is served from memory only, not saved (${describe(error)})`)
      return
    }
    if (!texts) return
    const keep = new Set([manifest.files.ru.file, manifest.files.en.file])
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (SNAPSHOT_FILE.test(name) && !keep.has(name)) await rm(join(dir, name), { force: true }).catch(() => undefined)
    }
  }

  private async loadAll() {
    if (!this.options.dir) return
    for (const mode of QUEST_BASE_MODES) {
      try {
        const snapshot = await this.readMode(mode)
        if (!snapshot) continue
        this.state(mode).current = snapshot
        this.log(`quest base ${mode}: ${snapshot.manifest.version} loaded from disk (built ${snapshot.manifest.builtAt}, checked ${snapshot.manifest.checkedAt})`)
      } catch (error) {
        this.log(`quest base ${mode}: the snapshot on disk is not used (${describe(error)}); the mode is built again`)
      }
    }
  }

  private async readMode(mode: RaidMode): Promise<Snapshot | undefined> {
    const dir = join(this.options.dir!, mode)
    let names: string[]
    try { names = await readdir(dir) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    // Leftovers of a write that a stop or a crash interrupted.
    for (const name of names) if (name.endsWith(TEMPORARY_SUFFIX)) await rm(join(dir, name), { force: true }).catch(() => undefined)
    if (!names.includes(MANIFEST)) return undefined
    const manifest = parseManifest(JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')), mode)
    const datasets = {} as Record<CatalogLocale, AppDataset>
    for (const locale of LOCALES) {
      const entry = manifest.files[locale]
      const text = await readFile(join(dir, entry.file), 'utf8')
      if (hashWithoutLoadedAt(text, 'sha256') !== entry.hash) throw new Error(`${entry.file} does not match the manifest`)
      const data = JSON.parse(text) as AppDataset
      if (!isUsableCatalog(data) || data.metadata?.mode !== mode) throw new Error(`${entry.file} is not a usable ${mode} catalog`)
      datasets[locale] = stamped(data, manifest.version)
    }
    if (versionOf(manifest.files.ru.hash, manifest.files.en.hash) !== manifest.version) throw new Error('the version does not match the snapshots')
    return { ru: datasets.ru, en: datasets.en, manifest }
  }
}
