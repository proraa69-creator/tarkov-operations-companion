import type { GameMap, MapView, MarkerLayerId } from '../domain/types'
import type { PlayerPosition } from './screenshotPosition'
import type { ScreenshotKeyInfo } from './screenshotCheck'
import type { PictureQuery } from './iconMatch'

export type { ScreenshotCheck, ScreenshotCheckFile, ScreenshotKeyInfo } from './screenshotCheck'

export interface QuestNeed {
  questId: string
  name: string
  trader: string
  count: number
  kappa: boolean
  purpose: string
}

export interface ItemOverlayInfo {
  state: 'found'
  itemId: string
  name: string
  shortName: string
  iconUrl?: string
  /** Standard assembled weapon, not a reconstruction of the player's attachments. */
  weaponPreset?: boolean
  /** Flea price of the selected mode: the current lowest offer (or the 24-hour average, then `fleaAverage`). */
  fleaPrice?: number
  /** No current flea offer: `fleaPrice` is the 24-hour average. */
  fleaAverage?: boolean
  bestTrader?: { name: string; price: number }
  quests: QuestNeed[]
  kappa: boolean
  collector: boolean
  /** On the «Что не продавать» list of this mode: still needed for quests / hideout / Collector. */
  keep?: import('../raidprep/keepList').KeepBadge
  /** A friend or squad mate needs this item for a current quest (squad/mateNeeds.ts): only a bare «MATE» badge. */
  mate?: boolean
  /** How the tooltip lookup found it when not by the name at once (diagnostics): a remembered reading, the second
   * attempt's other OCR readings, or the picture check. */
  source?: 'memory' | 'retry' | 'picture'
}

export type ItemOverlayPayload =
  | { state: 'loading' }
  | { state: 'not-found'; text?: string }
  | ItemOverlayInfo

export interface MinimapMarker {
  id: string
  position: [number, number]
  layerId: MarkerLayerId
  title: string
  subtitle?: string
  questId?: string
  /** Game-space height of a quest point, to tell apart rooms on different floors (minimapView.ts). */
  height?: number
}

export type MinimapPayload =
  | { state: 'no-data'; reason?: string }
  | {
    state: 'ready'; map: GameMap; markers: MinimapMarker[]; questCount: number; quests?: MinimapQuest[]; opacity?: number; minimapWidth?: number; playerMarker?: 'arrow' | 'chevron' | 'dot'
    /** The drawing shown, as on the Maps page («Спутник» / «Схема»); the minimap draws the chosen floor in it. */
    view?: MapView
  }

/** A current quest that has at least one point on this map. */
export interface MinimapQuest {
  questId: string
  name: string
  trader: string
  markerIds: string[]
  /** What to do: the current story stage or the task objectives. */
  objectives: string[]
}

export interface ExperimentalSettings {
  version: 4
  itemLookup: boolean
  minimap: boolean
  tracking: boolean
  autoScreenshot: boolean
  screenshotIntervalMs: number
  itemKey: string
  minimapKey: string
  collectorKey: string
  minimapOpacity: number
  minimapWidth?: number
  playerMarker: 'arrow' | 'chevron' | 'dot'
  screenshotsDir: string
  /** Where the player dragged the minimap; null = top-right corner. */
  minimapPosition: { x: number; y: number } | null
  /** Start the app with administrator rights (the game runs elevated). */
  runAsAdmin: boolean
  /** Open the minimap for a moment when the player takes a screenshot in the game. */
  showOnScreenshot: boolean
  /** Unity key name the app presses for a screenshot; empty = the key set in the game. */
  screenshotKey: string
}

export interface ExperimentalStatus {
  hookReady: boolean
  hookError: string
  tracking: boolean
  screenshotsFolder: string
  /** Folders checked automatically, for the settings page. */
  screenshotCandidates: string[]
  /** Newest screenshot in the folder since tracking started, and whether its name carries coordinates. */
  lastScreenshot: { name: string; withCoordinates: boolean; at: number } | null
  /** How many times the app pressed the screenshot key this session. */
  screenshotPresses: number
  /** Screenshots the game wrote right after one of those presses. */
  filesAfterPress: number
  screenshotKey: ScreenshotKeyInfo
  /** Administrator rights of this app; null = unknown (not Windows). */
  elevated: boolean | null
  snipping: 'on' | 'off' | 'unknown'
  /** Why the Windows functions (game window, keys) could not be loaded; empty when they work. */
  nativeError: string
  /** When the game window was last in front; null = not seen since the app started. */
  gameSeenAt: number | null
  /** Whether keys pressed while the game is in front reach this app (hidden: the game runs elevated). */
  gameKeys: 'visible' | 'hidden' | 'unknown'
  lastPosition: PlayerPosition | null
  raid: { inRaid: boolean; location?: string }
  /** Display mode of the game the last time it was in front. */
  displayMode: 'exclusive' | 'fullscreen' | 'normal' | 'unknown'
}

export type ExperimentalQuery =
  | { id: number; kind: 'item'; input: {
    text: string
    test?: boolean
    lines?: NearbyLine[]
    /** The text is the game's name tooltip (one full name). */
    tooltip?: boolean
    /** Second attempt: when this text names an item, remember these first readings as that item (see lookupMemory). */
    remember?: string[]
  } }
  /** Second attempt, picture check: the items the readings could name (src/overlay/iconMatch.ts). */
  | { id: number; kind: 'item-candidates'; input: { texts: string[] } }
  | { id: number; kind: 'item-picture'; input: PictureQuery }
  | { id: number; kind: 'minimap'; input: { location?: string; fromApp?: boolean } }

/** An OCR line around the cursor and its distance from the cursor in screen pixels. */
export interface NearbyLine { text: string; distance: number }
