import type { Item, Quest } from '../domain/types'
import { ITEM_TEXT_MIN_SCORE, itemTextScore } from '../overlay/itemMatch'

const COLLECTOR_NAME = /^\s*(коллекционер|collector)\s*$/i

export interface CollectorEntry {
  item: Item
  count: number
}

/** The Collector task (the one that gives the Kappa container); its items come from the live catalog. */
export function findCollectorQuest(quests: Quest[]) {
  return quests.find((quest) => COLLECTOR_NAME.test(quest.name) && !quest.id.startsWith('wiki:'))
    ?? quests.find((quest) => /коллекционер|collector/i.test(quest.name) && !quest.id.startsWith('wiki:'))
}

export function collectorEntries(quests: Quest[], items: Item[]): CollectorEntry[] {
  const quest = findCollectorQuest(quests)
  if (!quest) return []
  const byId = new Map(items.map((item) => [item.id, item]))
  const counts = new Map<string, number>()
  for (const requirement of quest.raidRequirements ?? []) {
    if (!requirement.itemId) continue
    counts.set(requirement.itemId, (counts.get(requirement.itemId) ?? 0) + Math.max(1, requirement.count || 1))
  }
  for (const id of quest.requiredItems ?? []) if (!counts.has(id)) counts.set(id, 1)
  return [...counts.entries()].flatMap(([id, count]) => {
    const item = byId.get(id)
    return item ? [{ item, count }] : []
  }).sort((a, b) => a.item.name.localeCompare(b.item.name, 'ru'))
}

/** Which of the wanted items are visible in the OCR text of one screen. */
export function findVisibleItems(entries: CollectorEntry[], ocrText: string) {
  if (!ocrText.trim()) return []
  return entries.filter(({ item }) => itemTextScore(item, ocrText) >= ITEM_TEXT_MIN_SCORE).map(({ item }) => item.id)
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

export function saveCollected(mode: string, ids: string[]) {
  try { localStorage.setItem(STORAGE_PREFIX + mode, JSON.stringify([...new Set(ids)])) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(COLLECTOR_CHANGED_EVENT))
}

/** Scans the game screen and adds every wanted item that is visible; never unticks anything. */
export async function scanForCollectorItems(mode: string, entries: CollectorEntry[]) {
  const api = window.tarkovDesktop
  if (!api) return { ok: false as const, reason: 'desktop' as const }
  const frame = await api.captureQuestFrame(false, true)
  const found = findVisibleItems(entries, frame.text)
  const current = loadCollected(mode)
  const added = found.filter((id) => !current.includes(id))
  if (added.length) saveCollected(mode, [...current, ...added])
  return { ok: true as const, found: found.length, added: added.length, gameWindow: frame.gameWindow }
}
