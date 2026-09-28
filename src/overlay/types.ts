import type { GameMap, MarkerLayerId } from '../domain/types'
import type { PlayerPosition } from './screenshotPosition'

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
  fleaPrice?: number
  bestTrader?: { name: string; price: number }
  quests: QuestNeed[]
  kappa: boolean
  collector: boolean
}

export type ItemOverlayPayload = (
  | { state: 'loading' }
  | { state: 'not-found'; text?: string }
  | ItemOverlayInfo
) & { speak?: boolean; hideMs?: number }

export interface MinimapMarker {
  id: string
  position: [number, number]
  layerId: MarkerLayerId
  title: string
  subtitle?: string
}

export type MinimapPayload =
  | { state: 'no-data'; reason?: string }
  | { state: 'ready'; map: GameMap; markers: MinimapMarker[]; questCount: number }

export interface ExperimentalSettings {
  version: 3
  itemLookup: boolean
  minimap: boolean
  tracking: boolean
  autoScreenshot: boolean
  screenshotIntervalMs: number
  itemKey: string
  minimapKey: string
  collectorKey: string
  itemHideMs: number
  speakItem: 'off' | 'exclusive' | 'always'
}

export interface ExperimentalStatus {
  hookReady: boolean
  hookError: string
  tracking: boolean
  screenshotsFolder: string
  lastPosition: PlayerPosition | null
  raid: { inRaid: boolean; location?: string }
  /** Display mode of the game the last time it was in front. */
  displayMode: 'exclusive' | 'fullscreen' | 'normal' | 'unknown'
}

export type ExperimentalQuery =
  | { id: number; kind: 'item'; input: { text: string; test?: boolean } }
  | { id: number; kind: 'minimap'; input: { location?: string; fromApp?: boolean } }
