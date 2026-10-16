import type { AppDataset, RaidMode } from '../../../src/domain/types'
import { fetchLiveCatalog } from '../../../src/data/catalogSource'
import { resolvePlayerByNickname } from '../../../electron/playerProfileService'
import type { CatalogLocale } from './catalogCache.js'
import { applyMirroredPrices, createCatalogAnswers, MirroredPrices, type CatalogAnswer } from './catalogAnswers.js'
import { itemImageVersion, withCachedItemImages } from './itemImageCache.js'
import type { GuideImageMirror } from './guideImages.js'
import type { MirrorStorage } from './mirrorStorage.js'
import { QuestBase, type QuestBaseAppVersion } from './questBase.js'
import { WikiCache } from './wikiCache.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The game catalog the players' apps get (GET /v1/catalog/:mode). Its quests, maps and items come from the quest base
 * (services/questBase.ts: built on a schedule, kept on disk); the answers are prepared once per base version, price
 * generation and image set (services/catalogAnswers.ts).
 */
let mirrorStorage: MirrorStorage | undefined
let mirroredPrices: MirroredPrices | undefined
let guideImages: GuideImageMirror | undefined
/** tarkov.dev through the mirror on RaidNVMe (configureCatalogMirror); undefined: straight from tarkov.dev. */
let catalogFetch: typeof fetch | undefined
let wiki = new WikiCache()
let questBase = createQuestBase()

const MIRROR_MODE: Record<RaidMode, string> = { pvp: 'regular', pve: 'pve', seasonal: 'pvp-season' }

function createQuestBase(options: { dir?: string; periodMs?: number; app?: QuestBaseAppVersion; log?: (message: string) => void } = {}) {
  return new QuestBase({
    ...options,
    load: (mode, locale) => fetchLiveCatalog(mode, locale, catalogFetch, { wiki: () => wiki.load() }),
    sources: async (mode) => ({ tarkovDev: await tarkovDevSource(mode), wiki: { ...wiki.status() } }),
  })
}

/** The mirror generation the build read tarkov.dev's files from, and the upstream version of its tasks file. */
async function tarkovDevSource(mode: RaidMode): Promise<Record<string, unknown>> {
  if (!mirrorStorage) return { mirror: false }
  const generation = await mirrorStorage.generation(`dataset-${MIRROR_MODE[mode]}`).catch(() => undefined)
  if (!generation) return { mirror: true, generation: null }
  const tasks = (generation.metadata?.validators as Record<string, { etag?: string; modified?: string }> | undefined)?.tasks
  return { mirror: true, generation: generation.id, downloadedAt: generation.createdAt, ...(tasks ? { tasks } : {}) }
}

const answers = createCatalogAnswers({
  snapshot: (mode, locale) => questBase.snapshot(mode, locale),
  prices: async (mode) => (mirroredPrices ? mirroredPrices.current(mode) : { version: '' }),
  inputsVersion: itemImageVersion,
  decorate: (catalog, prices) => {
    const withImages = withCachedItemImages(prices ? applyMirroredPrices(catalog, prices) : catalog)
    return guideImages ? guideImages.rewrite(withImages) : withImages
  },
})

/** «Оружейник»: the guides' screenshots from our server instead of tarkov.help (services/guideImages.ts). */
export function configureGuideImages(mirror: GuideImageMirror | undefined) {
  guideImages = mirror
}

/** Make the server-owned catalog read tarkov.dev datasets from RaidNVMe instead of the network. */
export function configureCatalogMirror(storage: MirrorStorage) {
  mirrorStorage = storage
  mirroredPrices = new MirroredPrices(storage, (message) => console.warn(message))
  const strict = process.env.RAIDOS_DATA_STRICT === '1'
  const mirroredFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.hostname === 'json.tarkov.dev') {
      const match = /^\/(regular|pve|pvp-season)\/([a-z]+(?:_(?:ru|en))?)$/.exec(url.pathname)
      const name = match?.[2]
      const bytes = match && name ? await storage.read(`dataset-${match[1]}`, `${name}.json`) : undefined
      return bytes ? new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } }) : strict ? new Response('Mirror snapshot unavailable', { status: 503 }) : fetch(input, init)
    }
    if ((url.hostname === 'raidos.app' && url.pathname === '/v1/map-tiles/maps.json') || (url.hostname === 'raw.githubusercontent.com' && url.pathname.endsWith('/src/data/maps.json'))) {
      const bytes = await readFile(join(storage.root, 'maps.json')).catch(() => undefined)
      return bytes ? new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } }) : strict ? new Response('Mirror snapshot unavailable', { status: 503 }) : fetch(input, init)
    }
    return strict ? new Response('External catalog source disabled', { status: 503 }) : fetch(input, init)
  }
  catalogFetch = mirroredFetch
}

/**
 * The server's quest base: kept in `dir` (one folder per mode, plus the wiki's answer), built every `periodMs`.
 * index.ts calls it once at start, before `start()`; without it the base lives in memory and builds on the first request.
 */
export function configureQuestBase(options: { dir?: string; periodMs?: number; app?: QuestBaseAppVersion; log?: (message: string) => void }) {
  questBase.stop()
  wiki = new WikiCache({ file: options.dir ? join(options.dir, 'wiki.json') : undefined, log: options.log })
  questBase = createQuestBase(options)
  return questBase
}

export function currentQuestBase() {
  return questBase
}

/** The prepared answer of GET /v1/catalog/:mode: Russian (with the wiki's details) or English (tarkov.dev's own text). */
export function getCatalogAnswer(mode: RaidMode, locale: CatalogLocale = 'ru'): Promise<CatalogAnswer> {
  return answers.get(mode, locale)
}

/**
 * Non-blocking read for summaries (Kappa totals, quest names): the Russian snapshot of the base, or undefined while the
 * mode has none yet. Builds run on the base's schedule, never from here.
 */
export function peekCatalogSnapshot(mode: RaidMode): AppDataset | undefined {
  return questBase.peek(mode)
}

/**
 * «Привязать ник»: the account id from the player's game logs (sent by the desktop app), tarkov.dev's live search, then
 * the published index; a profile not published yet comes back `pending` and is bound anyway (electron/playerProfileService.ts).
 */
export async function resolvePlayer(mode: RaidMode, nickname: string, accountIdHint?: number) {
  return resolvePlayerByNickname(mode, nickname, accountIdHint)
}
