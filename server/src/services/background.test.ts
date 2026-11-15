import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { AppDataset, Quest, RaidMode } from '../../../src/domain/types'
import type { CatalogLocale } from './catalogCache.js'
import { BackgroundStatusReader, backgroundModeFromEnv, requestQuestBaseBuild, watchQuestBaseBuildRequests, writeBackgroundStatus } from './background.js'
import { legacyGraphqlIntervalMs } from './legacyGraphqlBuilder.js'
import { MirrorStorage } from './mirrorStorage.js'
import { QuestBase } from './questBase.js'

const free = async () => 10 * 1024 ** 3

async function tempDir(t: test.TestContext, prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const quest = (id: string, name: string): Quest => ({ id, name, trader: 'Прапор', mapIds: [], level: 1, kappa: false, description: '', objectives: [], rewards: [] }) as unknown as Quest

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

test('background mode: only RAIDOS_BACKGROUND=external hands the work to the worker', () => {
  assert.equal(backgroundModeFromEnv({}), 'inline')
  assert.equal(backgroundModeFromEnv({ RAIDOS_BACKGROUND: 'inline' }), 'inline')
  assert.equal(backgroundModeFromEnv({ RAIDOS_BACKGROUND: ' external ' }), 'external')
})

test('legacy GraphQL answers: every 30 minutes by default, RAIDOS_LEGACY_GRAPHQL_MINUTES otherwise', () => {
  assert.equal(legacyGraphqlIntervalMs(undefined), 30 * 60_000)
  assert.equal(legacyGraphqlIntervalMs(''), 30 * 60_000)
  assert.equal(legacyGraphqlIntervalMs('0'), 30 * 60_000)
  assert.equal(legacyGraphqlIntervalMs('5'), 5 * 60_000)
})

test('mirror storage: two storages on one folder (the API and the worker) never lose each other\'s slots', async (t) => {
  const root = await tempDir(t, 'raidos-mirror-lock-')
  const api = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: free })
  const worker = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: free })
  const publishAll = (storage: MirrorStorage, prefix: string) => Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const transaction = await storage.begin(`${prefix}-${index}`)
    await transaction.write('data.json', JSON.stringify({ prefix, index }))
    return transaction.publish()
  }))
  await Promise.all([publishAll(api, 'api'), publishAll(worker, 'worker')])
  const active = JSON.parse(await readFile(join(root, 'snapshots', 'active.json'), 'utf8')) as { slots: Record<string, unknown> }
  assert.equal(Object.keys(active.slots).length, 24)
  for (let index = 0; index < 12; index += 1) {
    assert.deepEqual(JSON.parse(String(await api.read(`worker-${index}`, 'data.json'))), { prefix: 'worker', index })
    assert.deepEqual(JSON.parse(String(await worker.read(`api-${index}`, 'data.json'))), { prefix: 'api', index })
  }
})

test('mirror storage: a lock left by a process that is gone does not stop the next publish', async (t) => {
  const root = await tempDir(t, 'raidos-mirror-stale-')
  const storage = new MirrorStorage({ root, minFreeBytes: 1, freeBytes: free })
  // A real process id that has ended: a short child, waited for.
  const child = spawn(process.execPath, ['-e', ''])
  const pid = child.pid!
  await new Promise((resolve) => child.on('exit', resolve))
  await mkdir(join(root, 'snapshots'), { recursive: true })
  await writeFile(join(root, 'snapshots', 'active.json.lock'), `${pid} 00000000-dead ${new Date().toISOString()}\n`)
  const transaction = await storage.begin('prices-pve')
  await transaction.write('prices.json', '{}')
  const result = await transaction.publish()
  assert.equal(result.published, true)
  assert.equal(String(await storage.read('prices-pve', 'prices.json')), '{}')
})

test('quest base follow: the API reads what the builder saves, a new version at the next look, the same one keeps its objects', async (t) => {
  const dir = await tempDir(t, 'raidos-quest-follow-')
  let title = 'первое'
  const load = async (mode: RaidMode, locale: CatalogLocale) => catalog(mode, [quest(`${mode}-q1`, locale === 'ru' ? title : `${title} en`)])
  let clock = Date.parse('2026-11-14T00:00:00.000Z')
  const builder = new QuestBase({ dir, load, now: () => clock, log: () => undefined, mirrorDebounceMs: 0 })
  await builder.start()
  await builder.snapshot('pve')
  await builder.idle()

  const asked: RaidMode[][] = []
  const follower = new QuestBase({ dir, load: async () => { throw new Error('a follower never builds') }, log: () => undefined, follow: { requestBuild: (modes) => asked.push([...modes]), pollMs: 60_000 } })
  t.after(() => { builder.stop(); follower.stop() })
  await follower.start()
  const first = await follower.snapshot('pve')
  assert.equal(first.quests[0]!.name, 'первое')
  assert.equal(follower.version('pve'), builder.version('pve'))

  // A check that finds nothing new rewrites the manifest only: the snapshots stay the very same objects.
  clock += 31 * 60_000
  builder.mirrorUpdated(['pve'])
  await new Promise((resolve) => setTimeout(resolve, 20))
  await builder.idle()
  await (follower as unknown as { followDisk(): Promise<void> }).followDisk()
  assert.equal(await follower.snapshot('pve'), first)
  assert.equal(follower.report().modes.pve.checkedAt, builder.report().modes.pve.checkedAt)

  // A new version is read at the next look.
  title = 'новое'
  builder.mirrorUpdated(['pve'])
  await new Promise((resolve) => setTimeout(resolve, 20))
  await builder.idle()
  await (follower as unknown as { followDisk(): Promise<void> }).followDisk()
  assert.equal((await follower.snapshot('pve')).quests[0]!.name, 'новое')
  assert.equal(follower.version('pve'), builder.version('pve'))

  // The owner's edit asks the builder instead of building here.
  follower.contentChanged()
  assert.deepEqual(asked, [['pvp', 'pve', 'seasonal']])
})

test('quest base follow: a mode with nothing on disk fails after the wait, without a build', async (t) => {
  const dir = await tempDir(t, 'raidos-quest-empty-')
  let builds = 0
  const follower = new QuestBase({ dir, load: async () => { builds += 1; throw new Error('no') }, log: () => undefined, follow: { requestBuild: () => undefined, pollMs: 60_000, waitMs: 30 } })
  t.after(() => follower.stop())
  await follower.start()
  await assert.rejects(follower.snapshot('seasonal'), /Каталог ещё не собран/)
  assert.equal(builds, 0)
})

test('background status: the API shows the worker\'s status while it writes, an error once it is quiet', async (t) => {
  const dir = await tempDir(t, 'raidos-background-status-')
  const path = join(dir, 'background-status.json')
  let now = Date.parse('2026-11-14T00:00:00.000Z')
  const reader = new BackgroundStatusReader(path, { now: () => now })
  assert.deepEqual(reader.source('prices').status(), { state: 'error', error: 'background worker is not running', workerSeenAt: null })
  await writeBackgroundStatus(path, { at: new Date(now).toISOString(), pid: 1, sources: { prices: { state: 'done', failures: 0 } } })
  await reader.refresh()
  assert.deepEqual(reader.source('prices').status(), { state: 'done', failures: 0 })
  // A job the worker does not run (turned off by its setting): idle, as the API itself would say.
  assert.deepEqual(reader.source('maps').status(), { state: 'idle' })
  now += 3 * 60_000
  assert.equal((reader.source('prices').status() as { state: string }).state, 'error')
  assert.equal(reader.questBase(), undefined)
})

test('quest base build requests: the API\'s request reaches the worker once', async (t) => {
  const dir = await tempDir(t, 'raidos-build-request-')
  const path = join(dir, 'quest-base-build-request.json')
  const seen: RaidMode[][] = []
  const watch = watchQuestBaseBuildRequests(path, (modes) => seen.push(modes), { everyMs: 60_000 })
  t.after(() => watch.stop())
  await watch.check()
  assert.deepEqual(seen, [])
  await requestQuestBaseBuild(path, ['pvp', 'pve', 'seasonal'])
  await watch.check()
  await watch.check()
  assert.deepEqual(seen, [['pvp', 'pve', 'seasonal']])
})
