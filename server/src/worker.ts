import { dirname, join } from 'node:path'
import { openDatabase, resolveDbPath } from './services/database.js'
import { MirrorStorage } from './services/mirrorStorage.js'
import { configureCatalogMirror, configureEventQuests, configureQuestBase } from './services/catalogService.js'
import { EventQuestStore } from './services/eventQuestStore.js'
import { questBasePeriodMs } from './services/questBase.js'
import { installProcessGuards } from './services/serverHealth.js'
import {
  backgroundModeFromEnv, backgroundPaths, backgroundStatusOf, createMirrorJobs, startMirrorJobs, stopMirrorJobs,
  watchQuestBaseBuildRequests, writeBackgroundStatus,
} from './services/background.js'

/**
 * The background worker (`npm run worker`, raidos-worker.service on its own CPU core): everything that builds data for
 * the players' apps on a schedule — tarkov.dev's datasets, the prices, the maps, the price history, «Торговля», the
 * legacy GraphQL answers and the quest base — so the API's cores only answer requests (services/background.ts).
 * It runs only with RAIDOS_BACKGROUND=external, which also tells the API to leave that work to it.
 */
installProcessGuards()

if (backgroundModeFromEnv() !== 'external') {
  console.log('Raid OS worker: RAIDOS_BACKGROUND is not "external", the API runs the background work itself; nothing to do')
  process.exit(0)
}

const dbPath = resolveDbPath()
if (dbPath === ':memory:') throw new Error('The worker needs the server database (TARKOV_DB_PATH)')
const dataDir = dirname(dbPath)
// The database only for the owner's event quests every quest base build adds (read; the API writes them).
const db = openDatabase(dbPath)
const mirrorEnabled = process.env.RAIDOS_DATA_MIRROR !== '0'
const mirrorRoot = process.env.RAIDOS_MIRROR_DIR || process.env.RAIDOS_MAP_MIRROR_DIR || join(dataDir, 'map-mirror')
const storage = mirrorEnabled ? new MirrorStorage({ root: mirrorRoot, requireMount: process.env.RAIDOS_MIRROR_REQUIRE_MOUNT === '1' }) : undefined
if (storage) configureCatalogMirror(storage)
if (mirrorEnabled) {
  process.env.RAIDOS_ITEM_IMAGE_DIR ||= join(mirrorRoot, 'images', 'items')
  process.env.RAIDOS_ITEM_IMAGE_URL ||= `${(process.env.TARKOV_PUBLIC_URL || 'https://raidos.app').replace(/\/$/, '')}/v1/item-images`
}
const questBase = configureQuestBase({
  dir: join(dataDir, 'quest-base'),
  periodMs: questBasePeriodMs(process.env.RAIDOS_QUEST_BASE_MINUTES),
  app: { version: process.env.TARKOV_APP_VERSION, build: Number(process.env.TARKOV_APP_BUILD) || undefined, commit: process.env.TARKOV_APP_COMMIT },
  log: (message) => console.log(message),
})
const eventQuests = new EventQuestStore(db)
configureEventQuests(() => eventQuests.list())
const jobs = createMirrorJobs({ storage, mirrorRoot, maps: mirrorEnabled && process.env.RAIDOS_MAP_MIRROR !== '0', questBase })
void questBase.start()
startMirrorJobs(jobs)

const paths = backgroundPaths(dataDir)
// The owner saved an event quest: the API asks for a build through this file (services/background.ts).
const requests = watchQuestBaseBuildRequests(paths.buildRequest, (modes) => {
  console.log(`quest base: a build asked by the API (${modes.join(', ')})`)
  questBase.mirrorUpdated(modes)
})
const writeStatus = () => writeBackgroundStatus(paths.status, backgroundStatusOf(jobs, questBase)).catch((error: unknown) => {
  console.error('Background status not saved', error instanceof Error ? error.message : 'unknown error')
})
void writeStatus()
const statusTimer = setInterval(() => { void writeStatus() }, 5_000)
console.log(`Raid OS worker ready (pid ${process.pid}; database ${dbPath}; mirror ${storage ? mirrorRoot : 'off'})`)

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  clearInterval(statusTimer)
  requests.stop()
  stopMirrorJobs(jobs)
  questBase.stop()
  db.close()
  process.exit(0)
})
