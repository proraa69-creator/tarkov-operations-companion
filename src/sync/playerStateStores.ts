/**
 * What goes to the account's other devices through src/sync/playerState.ts, list by list, in each store's own format. A store keeps
 * working as it did: read here from what it wrote, written here so that it reads it, its own listeners told. The names (`kind`) are on
 * the account: never renamed once released.
 *
 * What stays on one device, on purpose, and why, in one line each (the owner can overrule any of it):
 *  - raidos-overview-layout-v1, raidos-overview-phone-v2: the PC's and the phone's Overview are different things.
 *  - raidos-mobile-tabs-v1, raidos-phone-back-place-v1: the phone's own bar and back button.
 *  - tarkov-operations-ui-v2: the open map and its layers; the layers' defaults differ per screen, and joining them would hide what a
 *    device shows.
 *  - tarkov-operations-locale-v1, the theme (the phone keeps its own, PCs share theirs through /v1/me/settings), sound volume, gallery.
 *  - raidos-notifications-v1, *-notified-*, *-reminded-*: what this device told the player; each device tells by itself, joined they
 *    would double.
 *  - raidos-friend-colors-v1: given by itself in the order friends appear, not a choice of the player's.
 *  - raidos-auto-favorites-v1: what the deferral added here; «Избранное» itself and «Отложенные квесты» travel, and each device
 *    takes out what it added.
 *  - raidos-quest-keys-only-favorites-v1, raidos-map-friend-quests-v1: a view of a page, for this visit's screen.
 *  - the pencil's last colour (raidos-map-sketch-v1:color): the tool in this hand; every stroke carries its own colour across.
 *  - tours, the first-run guide, «seen» marks: shown once per device.
 *  - session, device id, entitlement, caches, the logs folder.
 */
import type { LocalProfile, RaidMode, StoryManual } from '../domain/types'
import { TRADER_LEVELS_SYNC } from '../gunsmith/traderLevels'
import { KAPPA_BADGE_SYNC } from '../kappa/kappaBadgeSetting'
import { MAP_SKETCH_SYNC, mapSketchKey, type SketchStroke } from '../maps/mapSketch'
import { ROOM_LAYERS_SYNC } from '../maps/roomLayers'
import { NEWS_SYNC, readNews } from '../news/newsState'
import { FOUND_DOCUMENTS_SYNC } from '../progression/foundDocuments'
import { QUEST_CHECKS_EVENT, questChecksKey } from '../progression/questChecks'
import { DEFERRED_FAVORITES_SYNC } from '../progression/questDeferral'
import { PROMO_SYNC } from '../promo/promoCodes'
import { QUEST_KEY_SYNC, questKeyFavoritesKey } from '../quests/questKeyFavorites'
import { keyUsesKey, OWNED_KEYS_EVENT, ownedKeysKey } from '../quests/ownedKeys'
import { RESTOCK_SETTINGS_SYNC } from '../restock/restockSettings'
import { TRADING_POSITIONS_SYNC } from '../trading/tradingPositions'
import { TRADING_SETTINGS_SYNC } from '../trading/tradingSettings'
import { SQUAD_SETTINGS_SYNC, SQUAD_SKETCH_HIDDEN_SYNC } from '../squad/squadSettings'
import { canonicalJson, hashOf, schedulePlayerStateSync, type StateAdapter, type StateMode } from './playerState'

const WHOLE_ACCOUNT: readonly StateMode[] = ['']
const EACH_MODE: readonly StateMode[] = ['pvp', 'pve', 'seasonal']

/** The local profile this device shows: the lists kept per profile are its. Null until the app knows it. */
let activeProfile: string | null = null
export function setPlayerStateProfile(profileId: string | null) { activeProfile = profileId }

function tell(event: string) { window.dispatchEvent(new Event(event)) }

/** What a key holds: `undefined` when nothing; null when it cannot be read or is damaged, which is no reason to take anything off. */
function readStored(key: string): { value: unknown } | null {
  let raw: string | null
  try { raw = localStorage.getItem(key) } catch { return null }
  if (raw === null) return { value: undefined }
  try { return { value: JSON.parse(raw) as unknown } } catch { return null }
}

function store(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch { /* storage unavailable or full: the next look finds it missing and sends the difference */ }
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const isTrue = (value: unknown) => value === true

/** A JSON array of ids. */
function setList(kind: string, modes: readonly StateMode[], key: (mode: StateMode) => string | null, event: string, options: { addOnly?: boolean; keepEmpty?: boolean } = {}): StateAdapter {
  return {
    kind, modes, ...(options.addOnly ? { addOnly: true } : {}), accepts: isTrue,
    read: (mode) => {
      const name = key(mode)
      const stored = name ? readStored(name) : null
      if (!stored) return null
      if (stored.value === undefined) return new Map()
      if (!Array.isArray(stored.value)) return null
      return new Map(stored.value.filter((id): id is string => typeof id === 'string').map((id) => [id, true]))
    },
    write: (mode, next) => {
      const name = key(mode)
      if (!name) return
      store(name, next.size || options.keepEmpty ? [...next.keys()] : undefined)
      tell(event)
    },
  }
}

/** A JSON object, item → value. */
function mapList(kind: string, modes: readonly StateMode[], key: (mode: StateMode) => string | null, event: string, accepts: (value: unknown) => boolean): StateAdapter {
  return {
    kind, modes, accepts,
    read: (mode) => {
      const name = key(mode)
      const stored = name ? readStored(name) : null
      if (!stored) return null
      if (stored.value === undefined) return new Map()
      if (!isObject(stored.value)) return null
      return new Map(Object.entries(stored.value).filter((entry) => accepts(entry[1])))
    },
    write: (mode, next) => {
      const name = key(mode)
      if (!name) return
      store(name, next.size ? Object.fromEntries(next) : undefined)
      tell(event)
    },
  }
}

const perProfile = (key: (profileId: string, mode: RaidMode) => string) => (mode: StateMode) => (activeProfile && mode ? key(activeProfile, mode) : null)

// ------------------------------------------------------------------------------------------------------------
// «Обновление»: what has been read. Before the first look a device counts every entry but the newest as read (news/newsState.ts),
// so what comes from another device joins that, or a device new to the account would meet a badge of ten
// ------------------------------------------------------------------------------------------------------------

const newsRead: StateAdapter = {
  ...setList('news-read', WHOLE_ACCOUNT, () => NEWS_SYNC.key, NEWS_SYNC.event, { addOnly: true, keepEmpty: true }),
  write: (_mode, next) => {
    store(NEWS_SYNC.key, [...new Set([...readNews(), ...next.keys()])])
    tell(NEWS_SYNC.event)
  },
}

// ------------------------------------------------------------------------------------------------------------
// «Купил» of «Торговля»: one list, each position naming its mode
// ------------------------------------------------------------------------------------------------------------

const tradingPositions: StateAdapter = {
  kind: 'trading-positions', modes: EACH_MODE,
  accepts: (value, item, mode) => TRADING_POSITIONS_SYNC.isPosition(value) && value.itemId === item && value.mode === mode,
  read: (mode) => {
    const stored = readStored(TRADING_POSITIONS_SYNC.key)
    if (!stored) return null
    if (stored.value === undefined) return new Map()
    if (!Array.isArray(stored.value)) return null
    return new Map(stored.value.filter(TRADING_POSITIONS_SYNC.isPosition).filter((row) => row.mode === mode).map((row) => [row.itemId, row]))
  },
  write: (mode, next) => {
    const stored = readStored(TRADING_POSITIONS_SYNC.key)?.value
    const others = Array.isArray(stored) ? stored.filter((row: { mode?: unknown } | null) => row?.mode !== mode) : []
    store(TRADING_POSITIONS_SYNC.key, [...others, ...[...next.values()].filter((row) => (row as { mode?: unknown }).mode === mode)])
    tell(TRADING_POSITIONS_SYNC.event)
  },
}

// ------------------------------------------------------------------------------------------------------------
// The traders' loyalty: the player's own levels and what the traders' screen showed (kept as one object, mode → its part)
// ------------------------------------------------------------------------------------------------------------

function traderList(kind: string, part: typeof TRADER_LEVELS_SYNC.manual | typeof TRADER_LEVELS_SYNC.screen, accepts: (value: unknown) => boolean): StateAdapter {
  return {
    kind, modes: EACH_MODE, accepts,
    read: (mode) => {
      const stored = readStored(part.key)
      if (!stored) return null
      if (stored.value === undefined) return new Map()
      if (!isObject(stored.value)) return null
      const forMode = stored.value[mode]
      return new Map(isObject(forMode) ? Object.entries(forMode).filter((entry) => accepts(entry[1])) : [])
    },
    write: (mode, next) => {
      const stored = readStored(part.key)?.value
      const all = { ...(isObject(stored) ? stored : {}) }
      if (next.size) all[mode] = Object.fromEntries(next)
      else delete all[mode]
      part.write(all as never)
    },
  }
}

const isScreenReading = (value: unknown) => isObject(value) && typeof value.at === 'string' && isObject(value.levels)

// ------------------------------------------------------------------------------------------------------------
// «Зарисовка»: stroke by stroke, so what two devices drew on one map both stay, and what the eraser took or split stays taken (a stroke
// it cut goes, its pieces are new ones). The strokes as they are stored: older ones with no colour and newer ones with one alike, and
// whatever a later version adds to a stroke goes through untouched
// ------------------------------------------------------------------------------------------------------------

const strokeItem = (mapId: string, stroke: unknown) => `${mapId}|${hashOf(canonicalJson(stroke))}`
const isStroke = (value: unknown) => isObject(value) && isNumber(value.zoom) && Array.isArray(value.points) && value.points.length > 0

function sketchMaps(mode: RaidMode): string[] | null {
  const start = mapSketchKey(activeProfile ?? '', mode, '')
  try {
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .flatMap((key) => (key?.startsWith(start) ? [key.slice(start.length)] : []))
  } catch { return null }
}

const mapSketches: StateAdapter = {
  kind: 'map-sketch', modes: EACH_MODE, accepts: isStroke,
  read: (mode) => {
    if (!activeProfile || !mode) return null
    const maps = sketchMaps(mode)
    if (!maps) return null
    const strokes = new Map<string, unknown>()
    for (const mapId of maps) {
      const stored = readStored(mapSketchKey(activeProfile, mode, mapId))
      if (!stored || !Array.isArray(stored.value)) return null
      for (const stroke of stored.value) if (isStroke(stroke)) strokes.set(strokeItem(mapId, stroke), stroke)
    }
    return strokes
  },
  write: (mode, next) => {
    if (!activeProfile || !mode) return
    const byMap = new Map<string, SketchStroke[]>((sketchMaps(mode) ?? []).map((mapId) => [mapId, []]))
    for (const [item, stroke] of next) {
      const mapId = item.slice(0, item.indexOf('|'))
      if (mapId) byMap.set(mapId, [...(byMap.get(mapId) ?? []), stroke as SketchStroke])
    }
    for (const [mapId, strokes] of byMap) MAP_SKETCH_SYNC.write(mapSketchKey(activeProfile, mode, mapId), strokes)
  },
}

// ------------------------------------------------------------------------------------------------------------
// The player's switches: each kept whole as the store wrote it
// ------------------------------------------------------------------------------------------------------------

const PREFS: ReadonlyArray<{ key: string; event: string }> = [
  DEFERRED_FAVORITES_SYNC,
  { key: QUEST_KEY_SYNC.reminder, event: QUEST_KEY_SYNC.event },
  TRADING_SETTINGS_SYNC,
  RESTOCK_SETTINGS_SYNC,
  KAPPA_BADGE_SYNC,
  SQUAD_SETTINGS_SYNC,
  SQUAD_SKETCH_HIDDEN_SYNC,
]

const prefs: StateAdapter = {
  kind: 'prefs', modes: WHOLE_ACCOUNT,
  accepts: (value, item) => typeof value === 'string' && value.length <= 2000 && PREFS.some((pref) => pref.key === item),
  read: () => {
    try {
      const values = new Map<string, unknown>()
      for (const { key } of PREFS) {
        const raw = localStorage.getItem(key)
        if (raw !== null) values.set(key, raw)
      }
      return values
    } catch { return null }
  },
  write: (_mode, next) => {
    for (const { key, event } of PREFS) {
      const value = next.get(key)
      try {
        const before = localStorage.getItem(key)
        if (typeof value === 'string' ? before === value : before === null) continue
        if (typeof value === 'string') localStorage.setItem(key, value)
        else localStorage.removeItem(key)
      } catch { continue }
      tell(event)
    }
  },
}

// ------------------------------------------------------------------------------------------------------------
// What the profile itself holds (state/AppState.tsx). React commits it later than it is told to, so what came from the server is held
// here until it shows in the state: a look in between must not read the old lists as a click that took it away
// ------------------------------------------------------------------------------------------------------------

export interface ModeLists { raidItemIds: string[]; hideoutLevels: Record<string, number>; itemCounts: Record<string, number>; storyManual?: StoryManual }
export interface ProfileLists { favoriteItemIds: string[]; modes: Record<RaidMode, ModeLists> }
export type PlayerListsChange = { favoriteItemIds: string[] } | ({ mode: RaidMode } & Partial<ModeLists>)

export function profileListsOf(profile: LocalProfile): ProfileLists {
  const of = (mode: RaidMode): ModeLists => {
    const progress = profile.modes[mode]
    return { raidItemIds: progress.raidItemIds, hideoutLevels: progress.hideoutLevels, itemCounts: progress.itemCounts ?? {}, ...(progress.storyManual ? { storyManual: progress.storyManual } : {}) }
  }
  return { favoriteItemIds: profile.modes[profile.selectedMode].favoriteItemIds, modes: { pvp: of('pvp'), pve: of('pve'), seasonal: of('seasonal') } }
}

/** How long what came from the server is waited for in the state. */
const HOLD_MS = 3000
let lists: ProfileLists | null = null
let committed: ProfileLists | null = null
let applyLists: ((change: PlayerListsChange) => void) | null = null
let hold: ReturnType<typeof setTimeout> | null = null

/** AppShell: the lists as the state holds them, whenever they changed. */
export function noteProfileLists(actual: ProfileLists | null, apply: ((change: PlayerListsChange) => void) | null) {
  applyLists = apply
  committed = actual
  if (hold) {
    if (canonicalJson(actual) !== canonicalJson(lists)) return
    clearTimeout(hold)
    hold = null
  }
  lists = actual
  if (actual) schedulePlayerStateSync()
}

function changeLists(change: PlayerListsChange, next: ProfileLists) {
  lists = next
  if (!hold) hold = setTimeout(() => { hold = null; lists = committed; schedulePlayerStateSync() }, HOLD_MS)
  applyLists?.(change)
}

function changeModeLists(mode: StateMode, part: Partial<ModeLists>) {
  if (!lists || !mode) return
  changeLists({ mode, ...part }, { ...lists, modes: { ...lists.modes, [mode]: { ...lists.modes[mode], ...part } } })
}

/** What a new profile starts with for show (state/AppState.tsx loadProfileState): nobody's choice, never sent to the account. */
const SHOWN_FAVORITES = new Set(['graphics-card', 'ledx', 'salewa'])

const favoriteItems: StateAdapter = {
  kind: 'favorite-items', modes: WHOLE_ACCOUNT, accepts: isTrue,
  read: () => (lists ? new Map(lists.favoriteItemIds.filter((id) => !SHOWN_FAVORITES.has(id)).map((id) => [id, true])) : null),
  write: (_mode, next) => { if (lists) changeLists({ favoriteItemIds: [...next.keys()] }, { ...lists, favoriteItemIds: [...next.keys()] }) },
}

const raidItems: StateAdapter = {
  kind: 'raid-items', modes: EACH_MODE, accepts: isTrue,
  read: (mode) => (lists && mode ? new Map(lists.modes[mode].raidItemIds.map((id) => [id, true])) : null),
  write: (mode, next) => changeModeLists(mode, { raidItemIds: [...next.keys()] }),
}

const hideoutLevels: StateAdapter = {
  kind: 'hideout-levels', modes: EACH_MODE, accepts: isNumber,
  read: (mode) => (lists && mode ? new Map(Object.entries(lists.modes[mode].hideoutLevels)) : null),
  write: (mode, next) => changeModeLists(mode, { hideoutLevels: Object.fromEntries(next) as Record<string, number> }),
}

const itemCounts: StateAdapter = {
  kind: 'item-counts', modes: EACH_MODE, accepts: isNumber,
  read: (mode) => (lists && mode ? new Map(Object.entries(lists.modes[mode].itemCounts)) : null),
  write: (mode, next) => changeModeLists(mode, { itemCounts: Object.fromEntries(next) as Record<string, number> }),
}

/** A story chapter's own ticks (`m|chapter`) and the answers of its route (`c|question`). */
const storyMarks: StateAdapter = {
  kind: 'story-marks', modes: EACH_MODE,
  accepts: (value, item) => (item.startsWith('c|') ? typeof value === 'string' : item.startsWith('m|') && isObject(value) && isObject(value.marks)),
  read: (mode) => {
    if (!lists || !mode) return null
    const manual = lists.modes[mode].storyManual
    return new Map<string, unknown>([
      ...Object.entries(manual?.chapters ?? {}).map(([id, chapter]): [string, unknown] => [`m|${id}`, chapter]),
      ...Object.entries(manual?.choices ?? {}).map(([id, option]): [string, unknown] => [`c|${id}`, option]),
    ])
  },
  write: (mode, next) => {
    const manual: StoryManual = { chapters: {}, choices: {} }
    for (const [item, value] of next) {
      if (item.startsWith('m|')) manual.chapters[item.slice(2)] = value as StoryManual['chapters'][string]
      else if (item.startsWith('c|')) manual.choices[item.slice(2)] = value as string
    }
    changeModeLists(mode, { storyManual: manual })
  },
}

// ------------------------------------------------------------------------------------------------------------

export const PLAYER_STATE_ADAPTERS: readonly StateAdapter[] = [
  setList('promo-used', WHOLE_ACCOUNT, () => PROMO_SYNC.used, PROMO_SYNC.event, { keepEmpty: true }),
  setList('promo-read', WHOLE_ACCOUNT, () => PROMO_SYNC.read, PROMO_SYNC.event, { addOnly: true, keepEmpty: true }),
  newsRead,
  setList('map-room-layers', WHOLE_ACCOUNT, () => ROOM_LAYERS_SYNC.key, ROOM_LAYERS_SYNC.event),
  favoriteItems,
  prefs,
  raidItems,
  hideoutLevels,
  itemCounts,
  storyMarks,
  mapList('quest-checks', EACH_MODE, perProfile(questChecksKey), QUEST_CHECKS_EVENT, isNumber),
  mapList('found-documents', EACH_MODE, perProfile(FOUND_DOCUMENTS_SYNC.key), FOUND_DOCUMENTS_SYNC.event, isNumber),
  setList('quest-key-favorites', EACH_MODE, perProfile(questKeyFavoritesKey), QUEST_KEY_SYNC.event),
  // «Ключи в схроне»: the keys the player has and their uses left (quests/ownedKeys.ts)
  mapList('owned-keys', EACH_MODE, perProfile(ownedKeysKey), OWNED_KEYS_EVENT, isNumber),
  mapList('key-uses', EACH_MODE, perProfile(keyUsesKey), OWNED_KEYS_EVENT, isNumber),
  tradingPositions,
  mapSketches,
  traderList('trader-levels', TRADER_LEVELS_SYNC.manual, isNumber),
  traderList('trader-screen', TRADER_LEVELS_SYNC.screen, isScreenReading),
]

/** Every store's own «changed»: a look at the lists follows. */
export function watchPlayerStateStores(changed: () => void) {
  const events = [...new Set([
    PROMO_SYNC.event, NEWS_SYNC.event, ROOM_LAYERS_SYNC.event, QUEST_CHECKS_EVENT, FOUND_DOCUMENTS_SYNC.event, QUEST_KEY_SYNC.event,
    TRADING_POSITIONS_SYNC.event, MAP_SKETCH_SYNC.event, ...PREFS.map((pref) => pref.event),
  ])]
  for (const event of events) window.addEventListener(event, changed)
  const offManual = TRADER_LEVELS_SYNC.manual.subscribe(changed)
  const offScreen = TRADER_LEVELS_SYNC.screen.subscribe(changed)
  return () => {
    for (const event of events) window.removeEventListener(event, changed)
    offManual()
    offScreen()
  }
}
