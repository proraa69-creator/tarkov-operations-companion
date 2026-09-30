export type RaidMode = 'pvp' | 'pve' | 'seasonal'
export type MarkerType = 'quest' | 'extract' | 'key' | 'boss' | 'spawn' | 'cache' | 'danger' | 'landmark'
export type MarkerLayerId =
  | 'extract.pmc'
  | 'extract.scav'
  | 'extract.coop'
  | 'transit'
  | 'quest.zone'
  | 'quest.item'
  | 'key'
  | 'boss'
  | 'spawn'
  | 'hazard'
  | 'loot.valuable'
  | 'loot.weapon'
  | 'loot.medical'
  | 'loot.provision'
  | 'loot.technical'
  | 'loot.container'
  | 'loot.documents'
  | 'landmark'
export type ExtractFaction = 'pmc' | 'scav' | 'coop' | 'unknown'
export type TaskProgressStatus = 'unknown' | 'locked' | 'available' | 'active' | 'completed' | 'failed'
export type ProgressSource = 'manual' | 'eft-log' | 'profile-import' | 'backup' | 'migration' | 'inferred' | 'screen-scan'

export interface TaskRequirement {
  taskId: string
  allowedStatuses: Array<'complete' | 'failed' | 'active'>
  group?: string
}

export interface TaskProgressRecord {
  taskId: string
  status: 'active' | 'completed' | 'failed'
  source: ProgressSource
  updatedAt: string
  inferredFromTaskId?: string
  currentStageIndex?: number
}

export interface ModeRegistration {
  status: 'unregistered' | 'registered'
  enteredNickname?: string
  nickname?: string
  accountId?: number
  verifiedAt?: string
}

export interface PlayerProfileSnapshot {
  accountId: number
  nickname: string
  experience: number
  level: number
  faction: 'usec' | 'bear' | 'unknown'
  prestige: number
  accountType?: string
  totalInGameTime?: number
  equipment?: Array<{ itemId: string; slotId: string }>
  fetchedAt: string
  upstreamUpdatedAt?: string
}

export interface ModeProgress {
  registration: ModeRegistration
  playerSnapshot?: PlayerProfileSnapshot
  playerLevel: number
  faction: 'usec' | 'bear' | 'unknown'
  prestige: number
  taskProgress: Record<string, TaskProgressRecord>
  trackedTaskIds: string[]
  favoriteItemIds: string[]
  raidItemIds: string[]
  hideoutLevels: Record<string, number>
  seasonId?: string
  lastLogSyncAt?: string
  logCharacterId?: string
}

export interface LocalProfile {
  schemaVersion: 5
  id: string
  displayName: string
  createdAt: string
  updatedAt: string
  selectedMode: RaidMode
  modes: Record<RaidMode, ModeProgress>
}

export interface GameMap {
  id: string
  name: string
  subtitle: string
  raidTime: number
  players: string
  difficulty: 'Низкая' | 'Средняя' | 'Высокая' | 'Экстремальная'
  imageUrl?: string
  tileUrl?: string
  bounds?: [[number, number], [number, number]]
  /** Game-space bounds of the SVG scheme when they differ from the tile bounds (tarkov.dev `svgBounds`, e.g. Reserve). */
  svgBounds?: [[number, number], [number, number]]
  transform?: [number, number, number, number]
  coordinateRotation?: number
  tileSize?: number
  minZoom?: number
  maxZoom?: number
  accent: string
  floors?: string[]
  layers?: MapFloorLayer[]
  markerCount: number
  attribution?: string
}

/** How a map is drawn: tarkov.dev's top-down render tiles («Спутник») or its vector SVG scheme («Схема»). */
export type MapView = 'satellite' | 'digital'

export interface MapFloorExtent {
  height: [number, number]
  /** Game-space [x, z] rectangles; absent means the whole map. */
  bounds?: Array<[[number, number], [number, number]]>
}

export interface MapFloorLayer {
  svgLayer?: string
  id?: string
  name: string
  imageUrl?: string
  tileUrl?: string
  heightRange?: [number, number]
  extents?: MapFloorExtent[]
  /** True when the floor has its own tiles/svg instead of reusing the main map. */
  ownTiles?: boolean
}

export interface BossGear {
  name: string
  iconUrl?: string
  slot?: string
}

export interface BossInfo {
  key?: string
  name: string
  portraitUrl?: string
  spawnChance?: number
  locationChance?: number
  locationName?: string
  escorts?: string[]
  gear?: BossGear[]
  health?: number
}

export interface PossibleSpot {
  kind: 'item' | 'zone'
  /** 1-based position of this point among the objective's candidates on the map. */
  index: number
  /** Number of candidate points of the objective on this map. */
  count: number
}

export type KeycardColor = 'red' | 'green' | 'blue' | 'violet' | 'yellow' | 'black' | 'blue-marking' | 'residential' | 'access'

export interface MarkerLock {
  /** Key or keycard item id (tarkov.dev). */
  keyId?: string
  keyName: string
  /** Set for TerraGroup Labs keycards and other card readers. */
  keycard?: KeycardColor
  needsPower?: boolean
}

export interface MapMarker {
  id: string
  mapId: string
  type: MarkerType
  layerId?: MarkerLayerId
  title: string
  description: string
  position: [number, number]
  outline?: Array<[number, number]>
  floor?: string
  heightRange?: [number, number]
  /** Game-space Y of the point, used to pick the floor. */
  height?: number
  /** Position is a guess (e.g. map center), not a known objective point. */
  approximate?: boolean
  boss?: BossInfo
  questId?: string
  /** tarkov.dev objective id; all markers of one objective share it (and one icon). */
  objectiveId?: string
  /**
   * The point is one of several candidates of one quest objective: the item spawns at one of them
   * (`kind: 'item'`) or any of the close-together zones counts (`kind: 'zone'`). Shown as «Возможное место».
   */
  possibleSpot?: PossibleSpot
  /** Locked door / keycard reader: which key opens it. */
  lock?: MarkerLock
  stageIndex?: number
  itemId?: string
  extractId?: string
  extractFaction?: ExtractFaction
  source?: string
  requiresPower?: boolean
  requiresItem?: boolean
  requiresCoop?: boolean
  meta?: string
}

export interface QuestStage {
  id: string
  title: string
  description: string
  mapIds: string[]
  optional?: boolean
  landmarkHints?: string[]
  /** Extra strings for OCR matching of the in-game Tasks → Story detail panel. */
  ocrAliases?: string[]
  /** Expected progress denominator when the stage shows counters like 0/3. */
  progressTotal?: number
  /** Known map points of the stage (game x/z, tarkov.dev space); `outline` ([x, z][]) marks an area. */
  points?: Array<{ mapId: string; x: number; z: number; outline?: Array<[number, number]> }>
}

export interface Quest {
  id: string
  normalizedName?: string
  name: string
  trader: string
  mapId?: string
  level: number
  kappa: boolean
  kind?: 'trader' | 'story'
  storyOrder?: number
  description: string
  objectives: string[]
  stages?: QuestStage[]
  rewards: string[]
  requiredItems?: string[]
  previous?: string[]
  requirements?: TaskRequirement[]
  faction?: string
  experience?: number
  wikiLink?: string
  imageUrl?: string
  objectiveIds?: string[]
  mapIds?: string[]
  anyMap?: boolean
  raidRequirements?: Array<{ itemId: string; count: number; purpose: 'place' | 'mark' | 'key' | 'bring' | 'handover' | 'find'; mapIds: string[] }>
}

export interface PriceQuote {
  source: string
  price: number
  mode: RaidMode
  updatedAt: string
}

export interface Item {
  id: string
  normalizedName?: string
  name: string
  shortName: string
  category: 'Ключ' | 'Медицина' | 'Бартер' | 'Боеприпас' | 'Оружие' | 'Броня' | 'Еда' | 'Инструмент'
  description: string
  iconUrl?: string
  weight?: number
  slots?: string
  mapId?: string
  questIds?: string[]
  prices: PriceQuote[]
  caliber?: string
  damage?: number
  penetration?: number
  armorClass?: number
  width?: number
  height?: number
  fleaPrice?: number
  wikiLink?: string
  types?: string[]
}

export interface HideoutStation {
  id: string
  name: string
  normalizedName?: string
  level: number
  status: 'ready' | 'progress' | 'locked'
  requirements: string[]
  bonus: string
  maxLevel?: number
  imageUrl?: string
  layout?: { x: number; y: number }
  levels?: Array<{
    level: number
    requirements: string[]
    stationRequirements?: string[]
    bonus: string
    constructionTimeHours?: number
  }>
}

export interface Trader {
  id: string
  name: string
  role: string
  loyalty: number
  accent: string
  imageUrl?: string
}

export interface AppDataset {
  maps: GameMap[]
  markers: MapMarker[]
  quests: Quest[]
  items: Item[]
  hideout: HideoutStation[]
  traders: Trader[]
  metadata?: {
    source: string
    mode: RaidMode
    loadedAt: string
    counts: Record<string, number>
  }
}
