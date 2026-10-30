/**
 * «Синхронизация по экрану» (owner, 18.10.2026: «сделай на одну кнопку… если там есть предметы для каппы, он их добавляет
 * в каппу, если предметы для убежища, он их добавляет в убежище. такой же технологией как сделано в коллекционере»).
 * One scan of the game's own picture with the Collector's reader (electron/collectorScan.ts: screenshots of the game
 * window only, nothing injected, nothing pressed), then every recognised item goes where it is still wanted:
 *   - an item of the Collector task is ticked on «Каппа» (as the Kappa scan always did), and the pieces it needs are
 *     kept for it;
 *   - the pieces left over count for the hideout: the hideout's «found» becomes at least what the screen shows, never
 *     more than the unbuilt levels need. «At least», not «plus»: the same stash scanned twice is not counted twice.
 *   - then the quests (owner, 31.10.2026: «все обнаруженные предметы добавляются, для каппы, для убежища и квестов»): the
 *     pieces still left raise what is put aside for the quests still to do, the same «at least» way;
 *   - every item the hideout, the quests or the Collector ever asked for is remembered as seen in the stash
 *     (stashScan/stashSeen.ts) — «Не нужны» lists those nothing wants any more.
 * Kappa, hideout and quest lists belong to the current mode (and profile): PvP, PvE and Season stay apart.
 */
import type { HideoutStation, Item, RaidMode } from '../domain/types'
import { ITEM_TEXT_MIN_SCORE } from '../overlay/itemMatch'
import { findVisibleItems, loadCollected, saveCollected, screenEntries, screenScore, type CollectorEntry } from '../kappa/collector'
import { hideoutNeeds } from '../hideout/hideoutNeeds'
import { readHideoutFound, writeHideoutFound } from '../hideout/hideoutFound'
import { questFoundStore } from '../quests/questFound'
import { stashSeenStore } from './stashSeen'

/**
 * Pieces of each wanted item seen in the OCR text of the scan: one stash label is one line and one piece, given to the
 * item it fits best. An item seen only in the whole text (a name over two lines) counts as one.
 */
export function countScreenItems(entries: CollectorEntry[], ocrText: string): Map<string, number> {
  const seen = new Map<string, number>()
  if (!ocrText.trim()) return seen
  for (const line of ocrText.split(/\r?\n/)) {
    if (!line.trim()) continue
    let best: CollectorEntry | null = null
    let bestScore = ITEM_TEXT_MIN_SCORE
    for (const entry of entries) {
      const score = screenScore(entry, line)
      if (score >= bestScore && (!best || score > bestScore)) { best = entry; bestScore = score }
    }
    if (best) seen.set(best.item.id, (seen.get(best.item.id) ?? 0) + 1)
  }
  for (const id of findVisibleItems(entries, ocrText)) if (!seen.has(id)) seen.set(id, 1)
  return seen
}

export interface ScreenDistribution {
  /** Collector items newly ticked on «Каппа». */
  kappa: string[]
  /** Hideout items whose «found» goes up: item id → the new value. */
  hideout: Map<string, number>
  /** Pieces added to the hideout in all. */
  hideoutAdded: number
  /** Quest items whose put-aside pieces go up: item id → the new value. */
  quests: Map<string, number>
  questsAdded: number
}

/**
 * Where the recognised pieces go (pure). `seen`: pieces on screen per item; `kappa`: the Collector's items (id → pieces it
 * needs) and the ones already ticked; `hideout`: per item what is marked found and what the unbuilt levels need.
 * Kappa first: its pieces are kept for it (ticked now or before); the rest raise the hideout's «found» to what is left.
 */
export function distributeScreenItems(input: {
  seen: ReadonlyMap<string, number>
  kappa: { needs: ReadonlyMap<string, number>; collected: Iterable<string> }
  hideout: ReadonlyMap<string, { found: number; total: number }>
  /** Per item: pieces put aside for the quests and what the quests still to do need in all. */
  quests?: ReadonlyMap<string, { found: number; total: number }>
}): ScreenDistribution {
  const collected = new Set(input.kappa.collected)
  const kappa: string[] = []
  const hideout = new Map<string, number>()
  const quests = new Map<string, number>()
  let hideoutAdded = 0, questsAdded = 0
  for (const [id, pieces] of input.seen) {
    if (!(pieces > 0)) continue
    const forKappa = input.kappa.needs.get(id) ?? 0
    if (forKappa > 0 && !collected.has(id)) kappa.push(id)
    let left = Math.max(0, pieces - forKappa)
    const need = input.hideout.get(id)
    if (need) {
      const value = Math.min(need.total, Math.max(need.found, left))
      if (value > need.found) { hideout.set(id, value); hideoutAdded += value - need.found }
      left = Math.max(0, left - need.total)
    }
    const quest = input.quests?.get(id)
    if (quest) {
      const value = Math.min(quest.total, Math.max(quest.found, left))
      if (value > quest.found) { quests.set(id, value); questsAdded += value - quest.found }
    }
  }
  return { kappa, hideout, hideoutAdded, quests, questsAdded }
}

export interface ScreenSyncTargets {
  mode: RaidMode
  profileId: string
  kappa: CollectorEntry[]
  stations: HideoutStation[]
  built: Record<string, number>
  items: Item[]
  /** The quests still to do: per item the pieces they need in all (quests/questItemNeeds.ts, completed quests left out). */
  quests?: ReadonlyMap<string, number>
  /** Every item the hideout, the quests or the Collector ever asked for: remembered when seen in the stash. */
  known?: ReadonlySet<string>
}

export interface ScreenSyncPass {
  ok: true
  gameWindow: boolean
  waiting: boolean
  read: number
  pending: number
  /** Added by this pass: Collector items ticked, hideout pieces, quest pieces. */
  kappaAdded: string[]
  hideoutAdded: number
  questsAdded: number
}

/** The IPC accepts this many label names for a second look (electron/main.ts collector:scan-screen). */
const NAMES_LIMIT = 120

/**
 * One scan session (the Collector's: each label on screen read once while the player scrolls). `pass` reads one frame;
 * the pieces seen so far in this session are distributed again after each, against the lists as they are now.
 */
export function createScreenSync(targets: ScreenSyncTargets) {
  const kappaNeeds = new Map(targets.kappa.map(({ item, count }) => [item.id, Math.max(1, count)]))
  const totals = new Map(hideoutNeeds(targets.stations, targets.built, readHideoutFound(targets.profileId, targets.mode)).items
    .map((need) => [need.itemId, need]))
  // The hideout's items still to find; an item already wanted for Kappa keeps its Kappa entry.
  const hideoutCounts = new Map([...totals.values()].filter((need) => need.remaining > 0 && !kappaNeeds.has(need.itemId)).map((need) => [need.itemId, need.remaining]))
  // The quests' items still to find, then the rest of the known ones (read only to remember them as seen).
  const questCounts = new Map([...(targets.quests ?? new Map<string, number>())].filter(([id, total]) => total > 0 && !kappaNeeds.has(id) && !hideoutCounts.has(id)))
  const others = new Map([...(targets.known ?? new Set<string>())].filter((id) => !kappaNeeds.has(id) && !hideoutCounts.has(id) && !questCounts.has(id)).map((id) => [id, 1]))
  const entries = [...targets.kappa, ...screenEntries(hideoutCounts, targets.items), ...screenEntries(questCounts, targets.items), ...screenEntries(others, targets.items)]
  const collectedAtStart = new Set(loadCollected(targets.mode))
  const names = [
    ...targets.kappa.filter(({ item }) => !collectedAtStart.has(item.id)),
    ...entries.filter(({ item }) => hideoutCounts.has(item.id) || questCounts.has(item.id)),
  ].map(({ item }) => item.shortName ?? '').filter(Boolean).slice(0, NAMES_LIMIT)
  const seen = new Map<string, number>()

  async function pass(restart: boolean): Promise<ScreenSyncPass | { ok: false; reason: 'desktop' }> {
    const api = window.tarkovDesktop
    if (!api) return { ok: false, reason: 'desktop' }
    if (restart) seen.clear()
    const frame = api.scanScreenText
      ? await api.scanScreenText(restart ? { restart: true, names } : {})
      : await api.captureQuestFrame(false, true)
    for (const [id, pieces] of countScreenItems(entries, frame.text)) seen.set(id, (seen.get(id) ?? 0) + pieces)

    const collected = loadCollected(targets.mode)
    const found = readHideoutFound(targets.profileId, targets.mode)
    const hideout = new Map([...totals.values()].map((need) => [need.itemId, { found: Math.min(need.total, found.get(need.itemId) ?? 0), total: need.total }]))
    const marked = questFoundStore.read(targets.profileId, targets.mode)
    const quests = new Map([...(targets.quests ?? new Map<string, number>())].map(([id, total]) => [id, { found: Math.min(total, marked.get(id) ?? 0), total }]))
    const result = distributeScreenItems({ seen, kappa: { needs: kappaNeeds, collected }, hideout, quests })
    if (result.kappa.length) saveCollected(targets.mode, [...collected, ...result.kappa])
    if (result.hideout.size) {
      const next = new Map(found)
      for (const [id, value] of result.hideout) next.set(id, value)
      writeHideoutFound(targets.profileId, targets.mode, next)
    }
    if (result.quests.size) {
      const next = new Map(marked)
      for (const [id, value] of result.quests) next.set(id, value)
      questFoundStore.write(targets.profileId, targets.mode, next)
    }
    // What this scan saw in the stash replaces the last scan's (the items anything ever asked for).
    if (targets.known && (restart || seen.size)) {
      const stash = new Map([...seen].filter(([id]) => targets.known!.has(id) || kappaNeeds.has(id) || totals.has(id)))
      stashSeenStore.write(targets.profileId, targets.mode, stash)
    }
    return {
      ok: true,
      gameWindow: frame.gameWindow,
      waiting: 'waiting' in frame && frame.waiting === true,
      read: 'read' in frame ? frame.read ?? 0 : 0,
      pending: 'pending' in frame ? frame.pending ?? 0 : 0,
      kappaAdded: result.kappa,
      hideoutAdded: result.hideoutAdded,
      questsAdded: result.questsAdded,
    }
  }
  return { pass }
}

/** «Каппа: +N, Убежище: +M, Квесты: +K» — the result line of a screen sync. */
export function screenSyncSummary(kappa: number, hideout: number, quests = 0) {
  return `Каппа: +${kappa}, Убежище: +${hideout}, Квесты: +${quests}`
}
