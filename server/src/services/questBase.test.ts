import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { AppDataset, Quest, RaidMode } from '../../../src/domain/types'
import { fetchLiveCatalog } from '../../../src/data/catalogSource'
import { TO_THE_LIGHT_IDS } from '../../../src/data/curatedQuests'
import { toTheLightFetcher } from '../../../src/data/__fixtures__/toTheLightFeed'
import { conditionQuestsFetcher } from '../../../src/data/__fixtures__/conditionQuestsFeed'
import type { CatalogLocale } from './catalogCache.js'
import { CATALOG_RETRY_MS } from './catalogCache.js'
import { QUEST_BASE_MODES, QuestBase, questBasePeriodMs, type QuestBaseManifest, type QuestBaseOptions } from './questBase.js'

const PERIOD = 30 * 60_000
const DEBOUNCE = 60_000
const START = Date.parse('2026-10-14T10:00:00.000Z')

const quest = (id: string, name: string, extra: Partial<Quest> = {}): Quest => ({ id, name, trader: 'Прапор', mapIds: [], level: 1, kappa: false, description: '', objectives: [], rewards: [], ...extra })

function catalog(mode: RaidMode, quests: Quest[]): AppDataset {
  return {
    maps: [{ id: 'customs', name: 'Таможня', subtitle: '', raidTime: 40, players: '', difficulty: '', accent: '', markerCount: 0 }],
    markers: [],
    quests,
    items: [{ id: 'gas', name: 'Газоанализатор', shortName: 'Газ', category: 'Бартер', description: '', prices: [] }],
    hideout: [],
    traders: [],
    metadata: { source: 'json.tarkov.dev', mode, loadedAt: new Date().toISOString(), counts: {} },
  } as unknown as AppDataset
}

/** Russian and English quests of a mode as the catalog builder would give them. */
type Titles = Array<[id: string, ru: string, en: string]>
const titled = (mode: RaidMode, locale: CatalogLocale, titles: Titles) => catalog(mode, titles.map(([id, ru, en]) => quest(id, locale === 'ru' ? ru : en)))

/** A loader whose answer per mode can be changed (or made to fail); it records the calls and how many ran at once. */
function source(initial: (mode: RaidMode, locale: CatalogLocale) => AppDataset | Error = (mode, locale) => titled(mode, locale, [[`${mode}-q1`, `${mode} первое`, `${mode} first`]])) {
  let answer = initial
  const calls: string[] = []
  let active = 0
  let peak = 0
  const load = async (mode: RaidMode, locale: CatalogLocale) => {
    calls.push(`${mode}:${locale}`)
    active += 1
    peak = Math.max(peak, active)
    try {
      await new Promise((resolve) => setImmediate(resolve))
      const result = answer(mode, locale)
      if (result instanceof Error) throw result
      return result
    } finally { active -= 1 }
  }
  return { load, calls, peak: () => peak, set: (next: typeof initial) => { answer = next } }
}

async function tempDir(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'raidos-quest-base-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function base(options: Partial<QuestBaseOptions> & Pick<QuestBaseOptions, 'load'>) {
  const lines: string[] = []
  const questBase = new QuestBase({ periodMs: PERIOD, mirrorDebounceMs: DEBOUNCE, log: (line) => lines.push(line), ...options })
  return { questBase, lines }
}

/** Fake time moves on; the build its timer started (if any) is awaited. */
async function advance(t: test.TestContext, questBase: QuestBase, ms: number) {
  t.mock.timers.tick(ms)
  await questBase.idle()
}

const manifestOf = async (dir: string, mode: RaidMode) => JSON.parse(await readFile(join(dir, mode, 'manifest.json'), 'utf8')) as QuestBaseManifest

test('quest base: the period comes from RAIDOS_QUEST_BASE_MINUTES (5 minutes to a day, 30 by default)', () => {
  assert.equal(questBasePeriodMs(undefined), 30 * 60_000)
  assert.equal(questBasePeriodMs('abc'), 30 * 60_000)
  assert.equal(questBasePeriodMs('45'), 45 * 60_000)
  assert.equal(questBasePeriodMs('1'), 5 * 60_000)
  assert.equal(questBasePeriodMs('100000'), 24 * 60 * 60_000)
})

test('quest base schedule: built at start, then every period and after the mirror, one mode and one language at a time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
  const dir = await tempDir(t)
  const upstream = source()
  const { questBase } = base({ dir, load: upstream.load })
  await questBase.start()
  // Nothing on disk: every mode is built at once, in order, Russian then English, never two at a time.
  await advance(t, questBase, 0)
  assert.deepEqual(upstream.calls, ['pvp:ru', 'pvp:en', 'pve:ru', 'pve:en', 'seasonal:ru', 'seasonal:en'])
  assert.equal(upstream.peak(), 1)
  // Nothing more until the period is over.
  await advance(t, questBase, PERIOD - 1)
  assert.equal(upstream.calls.length, 6)
  await advance(t, questBase, 1)
  assert.equal(upstream.calls.length, 12)
  // The mirror published PvE twice in a row: one build of PvE once it is quiet.
  questBase.mirrorUpdated(['pve'])
  await advance(t, questBase, DEBOUNCE / 2)
  questBase.mirrorUpdated(['pve'])
  await advance(t, questBase, DEBOUNCE - 1)
  assert.equal(upstream.calls.length, 12)
  await advance(t, questBase, 1)
  assert.deepEqual(upstream.calls.slice(12), ['pve:ru', 'pve:en'])
  // A request never starts a build while a snapshot exists, however old.
  for (const mode of QUEST_BASE_MODES) await questBase.snapshot(mode, 'en')
  assert.equal(upstream.calls.length, 14)
  questBase.stop()

  // A restart within the period: the snapshots come from disk, nothing is built until the period is over.
  const again = source()
  const restarted = base({ dir, load: again.load }).questBase
  await advance(t, restarted, 10 * 60_000)
  await restarted.start()
  await advance(t, restarted, 0)
  assert.deepEqual(again.calls, [])
  assert.equal((await restarted.snapshot('pve')).quests[0]!.id, 'pve-q1')
  // PvE was checked last (after the mirror, 90 s later): it is due later than PvP and Season.
  await advance(t, restarted, PERIOD - 10 * 60_000 - 30_000)
  assert.deepEqual(again.calls, ['pvp:ru', 'pvp:en', 'seasonal:ru', 'seasonal:en'])
  restarted.stop()

  // A restart after a long stop: everything older than the period is built at start.
  const later = source()
  const stale = base({ dir, load: later.load }).questBase
  await advance(t, stale, 3 * PERIOD)
  await stale.start()
  await advance(t, stale, 0)
  assert.equal(later.calls.length, 6)
  stale.stop()
})

test('quest base disk: atomic snapshots and a manifest, read back at start without a build; a broken snapshot is built again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
  const dir = await tempDir(t)
  const { questBase } = base({ dir, load: source().load })
  await questBase.start()
  await advance(t, questBase, 0)
  const manifest = await manifestOf(dir, 'pvp')
  assert.match(manifest.version, /^[a-f0-9]{16}$/)
  assert.deepEqual((await readdir(join(dir, 'pvp'))).sort(), [`en-${manifest.version}.json`, 'manifest.json', `ru-${manifest.version}.json`])
  assert.equal(manifest.files.ru.file, `ru-${manifest.version}.json`)
  assert.match(manifest.files.ru.hash, /^[a-f0-9]{64}$/)
  assert.equal(manifest.mode, 'pvp')
  assert.equal(manifest.builtAt, new Date(START).toISOString())
  assert.equal((await questBase.snapshot('pvp')).metadata?.questBaseVersion, manifest.version)
  questBase.stop()

  // An interrupted write leaves a temporary file: it is removed at start and does not matter.
  await writeFile(join(dir, 'pvp', `manifest.json.123-abcdef12.tmp`), '{"broken"')
  const reader = source(() => new Error('the disk is enough'))
  const restarted = base({ dir, load: reader.load }).questBase
  await restarted.start()
  await advance(t, restarted, 0)
  assert.deepEqual(reader.calls, [])
  const pvp = await restarted.snapshot('pvp', 'en')
  assert.equal(pvp.quests[0]!.name, 'pvp first')
  assert.equal(pvp.metadata?.questBaseVersion, manifest.version)
  assert.equal(restarted.version('pvp'), manifest.version)
  assert.ok(!(await readdir(join(dir, 'pvp'))).some((name) => name.endsWith('.tmp')))
  restarted.stop()

  // A snapshot changed on disk no longer matches its manifest: not used, that mode is built again at start.
  const ruFile = join(dir, 'pvp', manifest.files.ru.file)
  await writeFile(ruFile, (await readFile(ruFile, 'utf8')).replace('pvp первое', 'pvp подмена'))
  const rebuilt = source()
  const { questBase: third, lines } = base({ dir, load: rebuilt.load })
  await third.start()
  await advance(t, third, 0)
  assert.deepEqual(rebuilt.calls, ['pvp:ru', 'pvp:en'])
  assert.ok(lines.some((line) => /quest base pvp: the snapshot on disk is not used/.test(line)))
  assert.equal((await third.snapshot('pvp')).quests[0]!.name, 'pvp первое')
  third.stop()
})

test('quest base: a failed, empty or wrong-mode build keeps the last good version, tried again after 1, 2, 5, then 15 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
  const upstream = source()
  const { questBase, lines } = base({ load: upstream.load })
  await questBase.start()
  await advance(t, questBase, 0)
  assert.equal((await questBase.snapshot('pvp')).quests[0]!.id, 'pvp-q1')
  const good = questBase.version('pvp')
  const tries = upstream.calls.length
  const others = (mode: RaidMode, locale: CatalogLocale) => titled(mode, locale, [[`${mode}-q1`, `${mode} первое`, `${mode} first`]])

  const failures: Array<[AppDataset | Error, number]> = [
    [new Error('HTTP 502'), CATALOG_RETRY_MS[0]!],
    [catalog('pvp', []), CATALOG_RETRY_MS[1]!],
    [titled('pve', 'ru', [['pve-q9', 'чужой', 'foreign']]), CATALOG_RETRY_MS[2]!],
    [new Error('HTTP 503'), CATALOG_RETRY_MS[3]!],
    [new Error('HTTP 504'), CATALOG_RETRY_MS[3]!],
  ]
  upstream.set((mode, locale) => (mode === 'pvp' ? failures[0]![0] : others(mode, locale)))
  questBase.mirrorUpdated(['pvp'])
  await advance(t, questBase, DEBOUNCE)
  for (const [index, [, retry]] of failures.entries()) {
    const report = questBase.report().modes.pvp
    assert.equal(report.version, good, 'the last good version stays')
    assert.equal(report.state.failures, index + 1)
    assert.equal(report.state.nextBuildAt, new Date(Date.now() + retry).toISOString())
    assert.equal((await questBase.snapshot('pvp')).quests[0]!.id, 'pvp-q1')
    const next = failures[index + 1]
    upstream.set((mode, locale) => (mode === 'pvp' ? next?.[0] ?? titled('pvp', locale, [['pvp-q2', 'второе', 'second']]) : others(mode, locale)))
    await advance(t, questBase, retry - 1)
    assert.equal(questBase.report().modes.pvp.state.failures, index + 1, 'nobody asks before the back-off is over')
    await advance(t, questBase, 1)
  }
  assert.ok(lines.some((line) => /build failed \(Источник данных вернул пустой каталог\)/.test(line)))
  assert.ok(lines.some((line) => /build failed \(Источник данных вернул каталог другого режима\)/.test(line)))
  // The sources are back: the new content replaces the base and the period starts again.
  const report = questBase.report().modes.pvp
  assert.notEqual(report.version, good)
  assert.equal(report.state.failures, 0)
  assert.equal(report.state.nextBuildAt, new Date(Date.now() + PERIOD).toISOString())
  assert.deepEqual((await questBase.snapshot('pvp')).quests.map((entry) => entry.id), ['pvp-q2'])
  assert.ok(upstream.calls.length > tries)
  questBase.stop()
})

test('quest base first start: a request waits for its mode; a failed first build fails the requests until the back-off is over', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
  const upstream = source(() => new Error('tarkov.dev недоступен'))
  const { questBase } = base({ load: upstream.load })
  const first = questBase.snapshot('seasonal')
  await new Promise((resolve) => setImmediate(resolve))
  t.mock.timers.tick(0)
  await assert.rejects(first, /tarkov.dev недоступен/)
  await questBase.idle()
  assert.deepEqual(upstream.calls, ['seasonal:ru'])
  // Within the back-off a request fails at once: no build per request.
  await assert.rejects(questBase.snapshot('seasonal'), /tarkov.dev недоступен/)
  assert.equal(upstream.calls.length, 1)
  upstream.set((mode, locale) => titled(mode, locale, [['s1', 'сезон', 'season']]))
  await advance(t, questBase, CATALOG_RETRY_MS[0]!)
  assert.deepEqual((await questBase.snapshot('seasonal', 'en')).quests.map((entry) => entry.name), ['season'])
  questBase.stop()
})

test('quest base: PvP, PvE and Season are built, kept and read back apart; a snapshot of another mode is refused', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
  const dir = await tempDir(t)
  const { questBase } = base({ dir, load: source().load })
  await questBase.start()
  await advance(t, questBase, 0)
  for (const mode of QUEST_BASE_MODES) {
    for (const locale of ['ru', 'en'] as const) {
      const data = await questBase.snapshot(mode, locale)
      assert.equal(data.metadata?.mode, mode)
      assert.deepEqual(data.quests.map((entry) => entry.id), [`${mode}-q1`])
    }
    assert.equal((await manifestOf(dir, mode)).mode, mode)
  }
  assert.notEqual(questBase.version('pvp'), questBase.version('pve'))
  questBase.stop()
  // PvP's files put in the PvE folder: the mode check refuses them, PvE is built again.
  for (const name of await readdir(join(dir, 'pve'))) await rm(join(dir, 'pve', name))
  for (const name of await readdir(join(dir, 'pvp'))) await writeFile(join(dir, 'pve', name), await readFile(join(dir, 'pvp', name)))
  const upstream = source()
  const restarted = base({ dir, load: upstream.load }).questBase
  await restarted.start()
  await advance(t, restarted, 0)
  assert.deepEqual(upstream.calls, ['pve:ru', 'pve:en'])
  assert.deepEqual((await restarted.snapshot('pve')).quests.map((entry) => entry.id), ['pve-q1'])
  restarted.stop()
})

test('quest base titles: every quest has nameRu and nameEn in both languages; story chapters from the chapter data', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
  const story = (name: string) => quest('story-falling-skies', name, { kind: 'story', normalizedName: 'falling-skies', trader: 'Глава истории' })
  let englishFirst = 'Shortage'
  const { questBase } = base({
    load: async (mode, locale) => catalog(mode, locale === 'ru'
      ? [quest('5936d90786f7742b1420ba5b', 'Дефицит'), story('Небеса в огне')]
      // The English catalog keeps the Russian name of a curated chapter (src/data/storyChapters.ts).
      : [quest('5936d90786f7742b1420ba5b', englishFirst), story('Небеса в огне')]),
  })
  await questBase.start()
  await advance(t, questBase, 0)
  for (const locale of ['ru', 'en'] as const) {
    const [trader, chapter] = (await questBase.snapshot('pve', locale)).quests
    assert.equal(trader!.nameRu, 'Дефицит')
    assert.equal(trader!.nameEn, 'Shortage')
    assert.equal(trader!.ocrAliases, undefined)
    assert.equal(chapter!.nameRu, 'Небеса в огне')
    assert.equal(chapter!.nameEn, 'Falling Skies')
    // The chapter's other names, never its own titles again.
    assert.deepEqual(chapter!.ocrAliases, ['Падающие небеса'])
  }
  assert.equal((await questBase.snapshot('pve', 'en')).quests[0]!.name, 'Shortage')
  assert.equal(questBase.report().modes.pve.counts.bothTitles, 2)
  // An English title tarkov.dev did not translate this time (its key) keeps the previous version's.
  englishFirst = '5936d90786f7742b1420ba5b name'
  questBase.mirrorUpdated(['pve'])
  await advance(t, questBase, DEBOUNCE)
  const [kept] = (await questBase.snapshot('pve', 'ru')).quests
  assert.equal(kept!.nameEn, 'Shortage')
  assert.deepEqual(questBase.report().modes.pve.changes?.renamed, [])
  questBase.stop()
})

test('quest base: the «На свет» series tarkov.dev lacks is in both snapshots of every mode, with both titles and its log ids', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
  // the app's own catalog builder on a tarkov.dev feed without the series (src/data/curatedQuests.ts)
  const { questBase } = base({ load: (mode, locale) => fetchLiveCatalog(mode, locale, toTheLightFetcher(), { wiki: async () => ({ titles: [], pages: [], storyQuests: [] }) }) })
  await questBase.start()
  await advance(t, questBase, 0)
  for (const mode of QUEST_BASE_MODES) {
    for (const locale of ['ru', 'en'] as const) {
      const quests = (await questBase.snapshot(mode, locale)).quests
      const first = quests.find((entry) => entry.id === TO_THE_LIGHT_IDS.trustButVerify)
      const last = quests.find((entry) => entry.id === TO_THE_LIGHT_IDS.gettingAcquainted)
      assert.equal(first?.nameRu, 'На свет. Доверяй, но проверяй')
      assert.equal(first?.nameEn, 'To the Light - Trust but Verify')
      assert.equal(last?.nameRu, 'На свет. Новое знакомство')
      assert.equal(last?.nameEn, 'To the Light - Getting Acquainted')
      // the title the same id had before game version 1.1.5 stays an OCR alias
      assert.deepEqual(last?.ocrAliases, ['Новое знакомство', 'Getting Acquainted'])
      assert.equal(Object.values(TO_THE_LIGHT_IDS).filter((id) => quests.some((entry) => entry.id === id)).length, 11)
    }
  }
  questBase.stop()
})

test('quest base: the kill conditions (weapon, parts, gear) reach both snapshots and the disk, as ids and names only', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
  const dir = await tempDir(t)
  // real json.tarkov.dev data of the quests with gear conditions (src/data/__fixtures__/tarkovDevConditionQuests.json)
  const feed = JSON.parse(await readFile(new URL('../../../src/data/__fixtures__/tarkovDevConditionQuests.json', import.meta.url), 'utf8')) as Record<string, unknown>
  const load: QuestBaseOptions['load'] = (mode, locale) => fetchLiveCatalog(mode, locale, conditionQuestsFetcher(feed), { wiki: async () => ({ titles: [], pages: [], storyQuests: [] }) })
  const { questBase } = base({ dir, load })
  await questBase.start()
  await advance(t, questBase, 0)
  questBase.stop()
  // read back from disk by a restarted base: what the phone gets
  const restarted = base({ dir, load: async () => { throw new Error('no build expected') } }).questBase
  await restarted.start()
  const patriotOf = async (mode: RaidMode, locale: CatalogLocale) => (await restarted.snapshot(mode, locale)).quests.find((quest) => quest.id === '64f5deac39e45b527a7c4232')!
  for (const mode of QUEST_BASE_MODES) {
    const ru = (await patriotOf(mode, 'ru')).objectiveDetails![0].conditions!
    assert.deepEqual(ru.weapons!.map((weapon) => weapon.id), ['6499849fc93611967b034949'])
    assert.deepEqual(ru.mods!.map((option) => option.map((part) => part.id)), [['5c0517910db83400232ffee5', '64c196ad26a15b84aa07132f']])
    assert.match(ru.mods![0][0].name, /ПС-320/)
    const en = (await patriotOf(mode, 'en')).objectiveDetails![0].conditions!
    assert.match(en.mods![0][0].name, /PS-320/)
    // no full items in the conditions: an id and a name each
    for (const ref of [...ru.weapons!, ...ru.mods!.flat()]) assert.deepEqual(Object.keys(ref).sort(), ['id', 'name'])
  }
  restarted.stop()
})

test('quest base renames: the earlier title of the same id becomes an OCR alias, kept in the manifest across versions and restarts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
  const dir = await tempDir(t)
  let titles: Titles = [['q1', 'Старое имя', 'Old name'], ['q2', 'Второе', 'Second']]
  const load = async (mode: RaidMode, locale: CatalogLocale) => titled(mode, locale, mode === 'pvp' ? titles : [['other', 'другое', 'other']])
  const { questBase, lines } = base({ dir, load })
  await questBase.start()
  await advance(t, questBase, 0)
  const first = questBase.version('pvp')!
  assert.deepEqual(questBase.report().modes.pvp.changes, { since: null, added: [], removed: [], renamed: [] })

  titles = [['q1', 'Новое имя', 'New name'], ['q3', 'Третье', 'Third']]
  await advance(t, questBase, PERIOD)
  const second = questBase.version('pvp')!
  assert.notEqual(second, first)
  const changes = questBase.report().modes.pvp.changes!
  assert.equal(changes.since, first)
  assert.deepEqual(changes.added, [{ id: 'q3', ru: 'Третье', en: 'Third' }])
  assert.deepEqual(changes.removed, [{ id: 'q2', ru: 'Второе', en: 'Second' }])
  assert.deepEqual(changes.renamed, [{ id: 'q1', lang: 'ru', from: 'Старое имя', to: 'Новое имя' }, { id: 'q1', lang: 'en', from: 'Old name', to: 'New name' }])
  for (const locale of ['ru', 'en'] as const) {
    const renamed = (await questBase.snapshot('pvp', locale)).quests.find((entry) => entry.id === 'q1')!
    assert.deepEqual(renamed.ocrAliases, ['Старое имя', 'Old name'])
    assert.equal(renamed.nameRu, 'Новое имя')
    assert.equal(renamed.nameEn, 'New name')
  }
  const manifest = await manifestOf(dir, 'pvp')
  assert.deepEqual(manifest.renames.q1!.map((entry) => [entry.lang, entry.from, entry.to, entry.version]), [['ru', 'Старое имя', 'Новое имя', second], ['en', 'Old name', 'New name', second]])
  assert.ok(lines.some((line) => line.includes(`quest base pvp: ${second} new version (since ${first}: +1 −1 ~2)`)))
  questBase.stop()

  // A restart and a build with the same titles: the aliases stay (from the manifest), the version too.
  const restarted = base({ dir, load }).questBase
  await advance(t, restarted, PERIOD)
  await restarted.start()
  await advance(t, restarted, 0)
  assert.equal(restarted.version('pvp'), second)
  assert.deepEqual((await restarted.snapshot('pvp')).quests.find((entry) => entry.id === 'q1')!.ocrAliases, ['Старое имя', 'Old name'])
  assert.equal(restarted.report().modes.pvp.changes?.since, first, 'the change list of the current version stays')
  assert.equal(restarted.report().modes.pvp.checkedAt, new Date(Date.now()).toISOString())
  restarted.stop()
})
