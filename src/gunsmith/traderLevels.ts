import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { PurchaseAccess } from '../arsenal/buildStats'
import type { Quest, RaidMode, TaskProgressStatus, Trader } from '../domain/types'

/**
 * The player's trader loyalty levels for «Оружейник» (owner, 11.10.2026: show whether a part can be bought from the
 * trader or has to come from the flea). EFT's logs that the app reads carry quest events only, not loyalty, so the
 * level is estimated per mode (PvP, PvE and Season apart):
 *   - at least the level the player's tasks prove: a taken or done task that needs loyalty N with a trader, a done
 *     task whose objective was to reach loyalty N;
 *   - at most the level the character's level allows (tarkov.dev `levels[].requiredPlayerLevel`).
 * The player can set a trader's real level with one click; that choice is kept per mode and wins over the estimate.
 */
export const MAX_TRADER_LEVEL = 4
/** The traders in the game's order (the strip of portraits at the trader screen). */
export const TRADER_ORDER = ['prapor', 'therapist', 'fence', 'skier', 'peacekeeper', 'mechanic', 'ragman', 'jaeger', 'ref']
/** Flea market from character level 15. */
export const FLEA_PLAYER_LEVEL = 15

export interface TraderLevelInfo {
  trader: Trader
  key: string
  /** The level the app uses: the player's own choice, else the estimate's lower bound. */
  level: number
  min: number
  max: number
  manual?: number
}

const clampLevel = (value: number) => Math.min(MAX_TRADER_LEVEL, Math.max(1, Math.round(value)))

export function traderKey(trader: Pick<Trader, 'normalizedName' | 'name'>) {
  return trader.normalizedName || trader.name.toLowerCase().replace(/\s+/g, '-')
}

/** Lowest and highest loyalty the player can have with a trader, from the tasks of this mode and the character level. */
export function estimateTraderLevel(trader: Pick<Trader, 'id' | 'levelPlayerLevels'>, quests: Quest[], statusOf: (questId: string) => TaskProgressStatus | undefined, playerLevel: number) {
  let min = 1
  for (const quest of quests) {
    const loyalty = quest.traderLoyalty
    if (!loyalty) continue
    const status = statusOf(quest.id)
    if (status !== 'active' && status !== 'completed') continue
    for (const need of loyalty.needed) if (need.traderId === trader.id) min = Math.max(min, need.level)
    if (status === 'completed') for (const reach of loyalty.reached) if (reach.traderId === trader.id) min = Math.max(min, reach.level)
  }
  const byPlayer = trader.levelPlayerLevels?.length
    ? trader.levelPlayerLevels.reduce((best, required, index) => (required <= playerLevel ? index + 1 : best), 1)
    : MAX_TRADER_LEVEL
  const max = Math.max(min, byPlayer)
  return { min: clampLevel(min), max: clampLevel(max) }
}

const STORAGE_KEY = 'raid-os-trader-levels-v1'
type Stored = Partial<Record<RaidMode, Record<string, number>>>
const listeners = new Set<() => void>()
let snapshot: { raw: string | null; value: Stored } = { raw: null, value: {} }

function readStored(): Stored {
  let raw: string | null = null
  try { raw = localStorage.getItem(STORAGE_KEY) } catch { /* storage blocked */ }
  if (raw === snapshot.raw) return snapshot.value
  let value: Stored
  try { value = raw ? JSON.parse(raw) as Stored : {} } catch { value = {} }
  snapshot = { raw, value: value && typeof value === 'object' ? value : {} }
  return snapshot.value
}

/** The player's own level for a trader in a mode; `null` clears it (back to the estimate). */
export function setManualTraderLevel(mode: RaidMode, key: string, level: number | null) {
  const stored = readStored()
  const forMode = { ...(stored[mode] ?? {}) }
  if (level === null) delete forMode[key]
  else forMode[key] = clampLevel(level)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, [mode]: forMode })) } catch { /* storage blocked */ }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener() }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage) }
}

export function traderLevelInfos(traders: Trader[], quests: Quest[], statusOf: (questId: string) => TaskProgressStatus | undefined, playerLevel: number, manual: Record<string, number> = {}): TraderLevelInfo[] {
  const order = (key: string) => { const index = TRADER_ORDER.indexOf(key); return index < 0 ? TRADER_ORDER.length : index }
  return traders
    .filter((trader) => (trader.levelPlayerLevels?.length ?? trader.loyalty) > 1)
    .map((trader) => {
      const key = traderKey(trader)
      const { min, max } = estimateTraderLevel(trader, quests, statusOf, playerLevel)
      const own = manual[key]
      return { trader, key, min, max, ...(own ? { manual: own } : {}), level: own ? clampLevel(own) : min }
    })
    .sort((a, b) => order(a.key) - order(b.key))
}

/** What the player can buy under these levels in this mode (flea from character level 15, when the mode has a flea). */
export function playerAccess(infos: TraderLevelInfo[], playerLevel: number, fleaEnabled: boolean, taskDone?: (taskId: string) => boolean): PurchaseAccess {
  return {
    traderLevel: 1,
    flea: fleaEnabled && playerLevel >= FLEA_PLAYER_LEVEL,
    traderLevels: Object.fromEntries(infos.map((info) => [info.key, info.level])),
    ...(taskDone ? { taskDone } : {}),
  }
}

/** The levels of this mode, live: estimate + the player's own choices. */
export function useTraderLevels(mode: RaidMode, traders: Trader[], quests: Quest[], statusOf: (questId: string) => TaskProgressStatus | undefined, playerLevel: number) {
  const stored = useSyncExternalStore(subscribe, readStored, () => ({}) as Stored)
  const manual = stored[mode]
  const infos = useMemo(() => traderLevelInfos(traders, quests, statusOf, playerLevel, manual), [manual, playerLevel, quests, statusOf, traders])
  const setLevel = useCallback((key: string, level: number | null) => setManualTraderLevel(mode, key, level), [mode])
  return { infos, setLevel }
}

/** I, II, III like the game; the fourth (top) level is a crown. */
export const loyaltyNumeral = (level: number) => (['I', 'II', 'III'][level - 1] ?? '')
