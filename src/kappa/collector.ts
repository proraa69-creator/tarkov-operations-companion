import type { Item, Quest } from '../domain/types'
import { ITEM_TEXT_MIN_SCORE, itemTextScore, normalizeOcr } from '../overlay/itemMatch'
import { labelScore } from './collectorMatch'

const COLLECTOR_NAME = /^\s*(коллекционер|collector)\s*$/i

export interface CollectorEntry {
  item: Item
  count: number
  /** Several other items carry the same label (ten masks are «Маска»): the label alone does not prove this item. */
  ambiguous?: boolean
}

/** The Collector task (the one that gives the Kappa container); its items come from the live catalog. */
export function findCollectorQuest(quests: Quest[]) {
  return quests.find((quest) => COLLECTOR_NAME.test(quest.name) && !quest.id.startsWith('wiki:'))
    ?? quests.find((quest) => /коллекционер|collector/i.test(quest.name) && !quest.id.startsWith('wiki:'))
}

export function collectorEntries(quests: Quest[], items: Item[]): CollectorEntry[] {
  const quest = findCollectorQuest(quests)
  if (!quest) return []
  const counts = new Map<string, number>()
  for (const requirement of quest.raidRequirements ?? []) {
    if (!requirement.itemId) continue
    counts.set(requirement.itemId, (counts.get(requirement.itemId) ?? 0) + Math.max(1, requirement.count || 1))
  }
  for (const id of quest.requiredItems ?? []) if (!counts.has(id)) counts.set(id, 1)
  return screenEntries(counts, items).sort((a, b) => a.item.name.localeCompare(b.item.name, 'ru'))
}

/**
 * The screen scan's wanted list (item id → pieces wanted) with the Collector's label check: a label that three or more
 * catalog items carry proves nothing alone. Also the hideout's list in «Синхронизация по экрану» (src/stashScan/screenSync.ts).
 */
export function screenEntries(counts: ReadonlyMap<string, number>, items: Item[]): CollectorEntry[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const labels = new Map<string, number>()
  for (const item of items) {
    const label = normalizeOcr(item.shortName ?? '')
    if (label) labels.set(label, (labels.get(label) ?? 0) + 1)
  }
  return [...counts.entries()].flatMap(([id, count]) => {
    const item = byId.get(id)
    if (!item) return []
    // One look-alike (the Raven's key, «Ворон») is rarely on screen with it; a label of three or more items is common.
    const ambiguous = (labels.get(normalizeOcr(item.shortName ?? '')) ?? 0) > 2
    return [ambiguous ? { item, count, ambiguous } : { item, count }]
  })
}

/**
 * Which of the wanted items are visible in the OCR text of one screen: their stash labels (also misread), or their full
 * names (a tooltip). An item whose label other items share is ticked only by its full name.
 */
export function findVisibleItems(entries: CollectorEntry[], ocrText: string) {
  if (!ocrText.trim()) return []
  return entries.filter((entry) => screenScore(entry, ocrText) >= ITEM_TEXT_MIN_SCORE).map(({ item }) => item.id)
}

/** How surely one wanted item shows in the OCR text (0–1): ITEM_TEXT_MIN_SCORE or more is seen. */
export function screenScore({ item, ambiguous }: CollectorEntry, ocrText: string) {
  const text = withoutPrintedCaps(ocrText, item.shortName)
  return ambiguous
    ? itemTextScore({ ...item, shortName: '' }, text)
    : Math.max(itemTextScore(item, text), labelScore(item, text))
}

/**
 * A word in capitals alone is a brand printed on an item's picture, not the label, when the item's own label has small
 * letters (owner, 31.10.2026: «показывает что нашел 3 аптечки salewa а у меня в схроне их нету» — three Surv12 kits were
 * in the stash, their pictures' print read as «SALEWA»). Such words are taken out before that item is looked for; labels
 * in capitals («AFAK», «CMS») are looked for as before.
 */
export function withoutPrintedCaps(ocrText: string, shortName: string | undefined) {
  if (!shortName || !/\p{Ll}/u.test(shortName)) return ocrText
  return ocrText.replace(/[\p{L}\p{N}]+/gu, (word) => (word.length >= 4 && /\p{Lu}/u.test(word) && !/\p{Ll}/u.test(word) ? ' ' : word))
}

const STORAGE_PREFIX = 'tarkov-collector-items-v1:'
export const COLLECTOR_CHANGED_EVENT = 'tarkov-collector-changed'

export function loadCollected(mode: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_PREFIX + mode) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

const DIRTY_PREFIX = 'tarkov-collector-dirty-v1:'

/**
 * localStorage is the offline cache of the server checklist. A local edit marks the mode "dirty" until the
 * server has accepted it (src/sync/serverSync.ts); `fromServer` writes the server copy without marking it.
 */
export function saveCollected(mode: string, ids: string[], options: { fromServer?: boolean } = {}) {
  try {
    localStorage.setItem(STORAGE_PREFIX + mode, JSON.stringify([...new Set(ids)]))
    if (!options.fromServer) localStorage.setItem(DIRTY_PREFIX + mode, '1')
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(COLLECTOR_CHANGED_EVENT))
}

export function isCollectorDirty(mode: string) {
  try { return localStorage.getItem(DIRTY_PREFIX + mode) === '1' } catch { return false }
}

export function clearCollectorDirty(mode: string) {
  try { localStorage.removeItem(DIRTY_PREFIX + mode) } catch { /* storage unavailable */ }
}

/**
 * Reads the game screen and adds every wanted item that is visible; never unticks anything. `restart` starts a new scan
 * (labels read in the previous one are read again). A call reads a few dozen labels (electron/collectorScan.ts);
 * `drain` keeps calling until every label on screen is read (the in-game hotkey: one press, the whole screen).
 */
export async function scanForCollectorItems(mode: string, entries: CollectorEntry[], options: { restart?: boolean; drain?: boolean } = {}) {
  const api = window.tarkovDesktop
  if (!api) return { ok: false as const, reason: 'desktop' as const }
  const names = entries.map(({ item }) => item.shortName ?? '').filter(Boolean)
  const found = new Set<string>()
  const added: string[] = []
  let gameWindow = false, waiting = false, read = 0
  for (let call = 0; call < (options.drain ? 30 : 1); call += 1) {
    const frame = api.scanScreenText
      ? await api.scanScreenText(call === 0 && options.restart ? { restart: true, names } : {})
      : await api.captureQuestFrame(false, true)
    for (const id of findVisibleItems(entries, frame.text)) found.add(id)
    const current = loadCollected(mode)
    const fresh = [...found].filter((id) => !current.includes(id))
    if (fresh.length) { saveCollected(mode, [...current, ...fresh]); added.push(...fresh) }
    gameWindow = gameWindow || frame.gameWindow
    read += 'read' in frame ? frame.read ?? 0 : 0
    waiting = 'waiting' in frame && frame.waiting === true
    if (waiting || !('pending' in frame) || !frame.pending) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return { ok: true as const, found: found.size, added, gameWindow, waiting, read }
}
