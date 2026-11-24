import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { RaidMode } from '../../../src/domain/types'
import { writeFileAtomic } from './atomicFile.js'
import { LegacyGraphqlBuilder } from './legacyGraphqlBuilder.js'
import { MapMirror } from './mapMirror.js'
import type { MirrorStorage } from './mirrorStorage.js'
import { PriceHistoryMirror } from './priceHistoryMirror.js'
import { PriceMirror } from './priceMirror.js'
import { overlayKeyFrom, PriceOverlay } from './priceOverlay.js'
import type { QuestBase, QuestBaseReport } from './questBase.js'
import { TarkovDataMirror, type MirrorMode } from './tarkovDataMirror.js'
import { TradingStats } from './tradingStats.js'

/**
 * The server's background work (owner, 14.11.2026: «3 ядра под людей… и 1 под сборку»): tarkov.dev's datasets, the
 * prices, the maps, the price history, «Торговля», the legacy GraphQL answers and the quest base builds.
 * - `inline` (default): the API process runs all of it, as before.
 * - `external` (RAIDOS_BACKGROUND=external, in the env file both services read): the worker (`npm run worker`,
 *   src/worker.ts, its own CPU core) runs it; the API only reads what it saves — the mirror storage, the quest base
 *   folder — and the worker's status file for the owner's views.
 */
export type BackgroundMode = 'inline' | 'external'

export function backgroundModeFromEnv(env: NodeJS.ProcessEnv = process.env): BackgroundMode {
  return env.RAIDOS_BACKGROUND?.trim() === 'external' ? 'external' : 'inline'
}

const QUEST_BASE_MODE: Record<MirrorMode, RaidMode> = { regular: 'pvp', pve: 'pve', 'pvp-season': 'seasonal' }

export interface MirrorJobs {
  dataMirror?: TarkovDataMirror
  priceMirror?: PriceMirror
  mapMirror?: MapMirror
  priceHistory?: PriceHistoryMirror
  tradingStats?: TradingStats
  legacyGraphql?: LegacyGraphqlBuilder
}

/**
 * The same objects in both processes: the one that runs the work starts them (startMirrorJobs); the API in `external`
 * mode keeps them unstarted for what it serves from disk (MapMirror.read, PriceHistoryMirror.request).
 */
export function createMirrorJobs(options: { storage?: MirrorStorage; mirrorRoot: string; maps: boolean; questBase: QuestBase; env?: NodeJS.ProcessEnv }): MirrorJobs {
  const { storage, mirrorRoot, questBase } = options
  const env = options.env ?? process.env
  const log = (message: string) => console.log(message)
  return {
    dataMirror: storage ? new TarkovDataMirror({ storage, log, onPublished: (modes) => questBase.mirrorUpdated(modes.map((mode) => QUEST_BASE_MODE[mode])) }) : undefined,
    priceMirror: storage ? new PriceMirror({ storage, log, overlay: new PriceOverlay({ readKey: overlayKeyFrom(), log }) }) : undefined,
    // Keep the existing layout: maps.json at the mirror root, tiles below root/maps/*.
    mapMirror: options.maps ? new MapMirror({ dir: mirrorRoot, storage, log }) : undefined,
    priceHistory: storage ? new PriceHistoryMirror({ storage, log }) : undefined,
    // «Торговля»: a slow pass a few times a day; RAIDOS_TRADING_STATS=0 turns it off, the app then says the statistics are not ready.
    tradingStats: storage && env.RAIDOS_TRADING_STATS !== '0' ? new TradingStats({ storage, log }) : undefined,
    legacyGraphql: storage ? new LegacyGraphqlBuilder({ storage, log }) : undefined,
  }
}

export function startMirrorJobs(jobs: MirrorJobs) {
  jobs.mapMirror?.start()
  jobs.dataMirror?.start()
  jobs.priceMirror?.start()
  jobs.priceHistory?.start()
  jobs.tradingStats?.start()
  jobs.legacyGraphql?.start()
}

export function stopMirrorJobs(jobs: MirrorJobs) {
  jobs.mapMirror?.stop(); jobs.dataMirror?.stop(); jobs.priceMirror?.stop(); jobs.legacyGraphql?.stop(); jobs.priceHistory?.stop(); jobs.tradingStats?.stop()
}

/** Where the worker keeps its status and the API asks it for a quest base build (beside the database). */
export function backgroundPaths(dataDir: string) {
  return { status: join(dataDir, 'background-status.json'), buildRequest: join(dataDir, 'quest-base-build-request.json') }
}

export const STATUS_SOURCES = ['datasets', 'prices', 'maps', 'legacyGraphql', 'priceHistory', 'trading'] as const
export type StatusSource = typeof STATUS_SOURCES[number]

export interface BackgroundStatus {
  at: string
  pid: number
  sources: Partial<Record<StatusSource, unknown>>
  questBase?: QuestBaseReport
}

export function backgroundStatusOf(jobs: MirrorJobs, questBase: QuestBase, now = new Date()): BackgroundStatus {
  const sources: BackgroundStatus['sources'] = {}
  if (jobs.dataMirror) sources.datasets = jobs.dataMirror.status()
  if (jobs.priceMirror) sources.prices = jobs.priceMirror.status()
  if (jobs.mapMirror) sources.maps = jobs.mapMirror.status()
  if (jobs.legacyGraphql) sources.legacyGraphql = jobs.legacyGraphql.status()
  if (jobs.priceHistory) sources.priceHistory = jobs.priceHistory.status()
  if (jobs.tradingStats) sources.trading = jobs.tradingStats.status()
  return { at: now.toISOString(), pid: process.pid, sources, questBase: questBase.report() }
}

export async function writeBackgroundStatus(path: string, status: BackgroundStatus) {
  await writeFileAtomic(path, `${JSON.stringify(status)}\n`)
}

/** The API's side (`external`): the worker's last status, read every few seconds; old news once the worker is quiet. */
export class BackgroundStatusReader {
  private last?: BackgroundStatus
  private key = ''
  private timer?: ReturnType<typeof setInterval>

  constructor(private readonly path: string, private readonly options: { maxAgeMs?: number; now?: () => number } = {}) {}

  start(everyMs = 5_000) {
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, everyMs)
    this.timer.unref?.()
    return this
  }

  stop() { if (this.timer) clearInterval(this.timer) }

  async refresh() {
    try {
      const info = await stat(this.path)
      const key = `${info.ino}:${info.mtimeMs}:${info.size}`
      if (key === this.key) return
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as BackgroundStatus
      if (parsed && typeof parsed.at === 'string' && parsed.sources && typeof parsed.sources === 'object') { this.last = parsed; this.key = key }
    } catch { /* no worker yet, or a write under way: the last one stays */ }
  }

  /** The worker wrote within maxAgeMs (default 2 minutes). */
  fresh() {
    const at = this.last ? Date.parse(this.last.at) : Number.NaN
    return Number.isFinite(at) && (this.options.now?.() ?? Date.now()) - at <= (this.options.maxAgeMs ?? 120_000)
  }

  /** A status for routes/dataMirror.ts: the worker's, or an error that says it is not running. */
  source(name: StatusSource): { status: () => unknown } {
    return {
      status: () => {
        const value = this.last?.sources[name]
        // A running worker without that job (turned off by its setting) reports nothing for it: idle, as in the API.
        if (this.fresh()) return value ?? { state: 'idle' }
        return { ...(value && typeof value === 'object' ? value : {}), state: 'error', error: 'background worker is not running', workerSeenAt: this.last?.at ?? null }
      },
    }
  }

  sources() {
    return Object.fromEntries(STATUS_SOURCES.map((name) => [name, this.source(name)])) as Record<StatusSource, { status: () => unknown }>
  }

  /** The builder's report of the quest base (its state, next build), when the worker is running. */
  questBase(): QuestBaseReport | undefined {
    return this.fresh() ? this.last?.questBase : undefined
  }
}

/** The API asks the worker for a quest base build (the owner changed an event quest). */
export async function requestQuestBaseBuild(path: string, modes: readonly RaidMode[], now = new Date()) {
  await writeFileAtomic(path, `${JSON.stringify({ at: now.toISOString(), modes })}\n`)
}

/**
 * The worker's side: a request newer than the last one seen asks the quest base for a build. At the start, requests of
 * the last ten minutes count (the API may have asked while the worker was restarting).
 */
export function watchQuestBaseBuildRequests(path: string, onRequest: (modes: RaidMode[]) => void, options: { everyMs?: number; now?: () => number } = {}) {
  let seen = (options.now?.() ?? Date.now()) - 10 * 60_000
  const check = async () => {
    try {
      const row = JSON.parse(await readFile(path, 'utf8')) as { at?: unknown; modes?: unknown }
      const at = typeof row.at === 'string' ? Date.parse(row.at) : Number.NaN
      if (!Number.isFinite(at) || at <= seen) return
      seen = at
      const modes = (Array.isArray(row.modes) ? row.modes : []).filter((mode): mode is RaidMode => mode === 'pvp' || mode === 'pve' || mode === 'seasonal')
      if (modes.length) onRequest(modes)
    } catch { /* none yet */ }
  }
  void check()
  const timer = setInterval(() => { void check() }, options.everyMs ?? 5_000)
  timer.unref?.()
  return { check, stop: () => clearInterval(timer) }
}
