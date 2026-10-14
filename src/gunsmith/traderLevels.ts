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
 * The game's traders' screen shows the real levels (src/account/logNickname.ts applyTraderScreen): a reading is kept per
 * mode and per character, with its time (audit P18), and counts as proof of at least that level — not as a permanent
 * override: a higher level the tasks prove later wins, and another character (a wipe, another profile id) starts
 * without it. A player's own choice, kept per mode, wins over both (no screen sets it at the moment).
 */
export const MAX_TRADER_LEVEL = 4
/** The traders in the game's order (the strip of portraits at the trader screen). */
export const TRADER_ORDER = ['prapor', 'therapist', 'fence', 'skier', 'peacekeeper', 'mechanic', 'ragman', 'jaeger', 'ref']
/** Flea market from character level 15. */
export const FLEA_PLAYER_LEVEL = 15

export interface TraderLevelInfo {
  trader: Trader
  key: string
  /** The level the app uses: the player's own choice, else the estimate's lower bound raised to the traders' screen's. */
  level: number
  min: number
  max: number
  manual?: number
  /** The level the game's traders' screen showed for this character in this mode (the last reading). */
  screen?: number
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

/** A JSON value in localStorage, read again only when its text changed (a stable snapshot for useSyncExternalStore). */
function jsonStore<T extends object>(key: string) {
  const listeners = new Set<() => void>()
  let snapshot: { raw: string | null; value: T } = { raw: null, value: {} as T }
  const read = (): T => {
    let raw: string | null = null
    try { raw = localStorage.getItem(key) } catch { /* storage blocked */ }
    if (raw === snapshot.raw) return snapshot.value
    let value: T
    try { value = raw ? JSON.parse(raw) as T : {} as T } catch { value = {} as T }
    snapshot = { raw, value: value && typeof value === 'object' ? value : {} as T }
    return snapshot.value
  }
  const write = (value: T) => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage blocked */ }
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    const onStorage = (event: StorageEvent) => { if (event.key === key) listener() }
    window.addEventListener('storage', onStorage)
    return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage) }
  }
  return { read, write, subscribe }
}

/**
 * The player's own levels, per mode. A new key: `raid-os-trader-levels-v1` held the traders' screen's readings as
 * permanent overrides of every character of the mode (audit P18) — no screen of the app set a level by hand since
 * 11.10.2026 — and is no longer read; the next look at the traders' screen gives the levels again.
 */
type ManualStored = Partial<Record<RaidMode, Record<string, number>>>
const manualStore = jsonStore<ManualStored>('raid-os-trader-levels-v2')

/** The traders' screen's readings: per mode, per character (the logs' profile id; '' while unknown), with their time. */
export interface TraderScreenLevels { at: string; levels: Record<string, number> }
type ScreenStored = Partial<Record<RaidMode, Record<string, TraderScreenLevels>>>
const screenStore = jsonStore<ScreenStored>('raid-os-trader-screen-v1')
const NONE: ManualStored & ScreenStored = {}
/** Characters kept per mode (the newest readings): a few profiles, never a growing list. */
const SCREEN_CHARACTERS_KEPT = 4

/** The levels the player set for a mode, by trader key. */
export function readManualTraderLevels(mode: RaidMode): Record<string, number> {
  return { ...(manualStore.read()[mode] ?? {}) }
}

/** The player's own level for a trader in a mode; `null` clears it (back to the estimate). */
export function setManualTraderLevel(mode: RaidMode, key: string, level: number | null) {
  const stored = manualStore.read()
  const forMode = { ...(stored[mode] ?? {}) }
  if (level === null) delete forMode[key]
  else forMode[key] = clampLevel(level)
  manualStore.write({ ...stored, [mode]: forMode })
}

/** The traders' screen's levels of a character in a mode, by trader key; none for another character. */
export function readScreenTraderLevels(mode: RaidMode, character: string | undefined): TraderScreenLevels | undefined {
  return screenStore.read()[mode]?.[character ?? '']
}

/**
 * A traders' screen reading of a character in a mode (`character`: the logs' profile id of that mode; undefined while
 * unknown — such a reading serves only while it stays unknown). Merged into that character's earlier reading, the newer
 * level of each trader winning; written only when something changed.
 */
export function saveScreenTraderLevels(mode: RaidMode, character: string | undefined, levels: Record<string, number>, at: string) {
  const stored = screenStore.read()
  const forMode = { ...(stored[mode] ?? {}) }
  const id = character ?? ''
  const earlier = forMode[id]
  const read = Object.fromEntries(Object.entries(levels).map(([trader, level]) => [trader, clampLevel(level)]))
  // The newer reading of each trader wins; an older one only fills in traders the stored one lacks.
  const merged = !earlier ? read : at >= earlier.at ? { ...earlier.levels, ...read } : { ...read, ...earlier.levels }
  if (earlier && earlier.at >= at && JSON.stringify(merged) === JSON.stringify(earlier.levels)) return
  forMode[id] = { at: earlier && earlier.at > at ? earlier.at : at, levels: merged }
  const kept = Object.entries(forMode).sort(([, a], [, b]) => b.at.localeCompare(a.at)).slice(0, SCREEN_CHARACTERS_KEPT)
  screenStore.write({ ...stored, [mode]: Object.fromEntries(kept) })
}

export function traderLevelInfos(traders: Trader[], quests: Quest[], statusOf: (questId: string) => TaskProgressStatus | undefined, playerLevel: number, manual: Record<string, number> = {}, screen: Record<string, number> = {}): TraderLevelInfo[] {
  const order = (key: string) => { const index = TRADER_ORDER.indexOf(key); return index < 0 ? TRADER_ORDER.length : index }
  return traders
    .filter((trader) => (trader.levelPlayerLevels?.length ?? trader.loyalty) > 1)
    .map((trader) => {
      const key = traderKey(trader)
      const estimate = estimateTraderLevel(trader, quests, statusOf, playerLevel)
      const own = manual[key]
      const seen = screen[key] ? clampLevel(screen[key]) : undefined
      // The game's screen proves at least its level; the tasks may prove more since, and the bound from the character's
      // level never hides what the game showed.
      const min = Math.max(estimate.min, seen ?? 1)
      const max = Math.max(estimate.max, min)
      return { trader, key, min, max, ...(own ? { manual: own } : {}), ...(seen ? { screen: seen } : {}), level: own ? clampLevel(own) : min }
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

/**
 * The levels of this mode, live: the estimate, the traders' screen's reading of this mode's character (`character`: the
 * logs' profile id the app holds for the mode, ModeProgress.logCharacterId) and the player's own choices.
 */
export function useTraderLevels(mode: RaidMode, traders: Trader[], quests: Quest[], statusOf: (questId: string) => TaskProgressStatus | undefined, playerLevel: number, character?: string) {
  const manual = useSyncExternalStore(manualStore.subscribe, manualStore.read, () => NONE as ManualStored)[mode]
  const screen = useSyncExternalStore(screenStore.subscribe, screenStore.read, () => NONE as ScreenStored)[mode]?.[character ?? '']?.levels
  const infos = useMemo(() => traderLevelInfos(traders, quests, statusOf, playerLevel, manual, screen), [manual, playerLevel, quests, screen, statusOf, traders])
  const setLevel = useCallback((key: string, level: number | null) => setManualTraderLevel(mode, key, level), [mode])
  return { infos, setLevel }
}

/** I, II, III like the game; the fourth (top) level is a crown. */
export const loyaltyNumeral = (level: number) => (['I', 'II', 'III'][level - 1] ?? '')
