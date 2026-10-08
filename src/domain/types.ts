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
  /** Latest visible objectives, not a prediction from the chapter's sequence. */
  storyObjectives?: StoryObjectiveReading[]
}

export interface StoryObjectiveReading {
  id: string
  text: string
  optional: boolean
  completed: boolean
  /** Catalogue reference for map points only; never a displayed stage number. */
  stageIndex?: number
  current?: number
  total?: number
  /** The grey hint line under the objective in the game («Для ремонта понадобится набор инструментов»). */
  hint?: string
}

/** Where an objective value came from. `sync` = another device / the server copy whose origin is unknown. */
export type ObjectiveSource = 'log' | 'ocr' | 'manual' | 'sync'

/** Per-mode state of one quest objective, keyed by the tarkov.dev objective id (names are display only). */
export interface ObjectiveProgress {
  objectiveId: string
  taskId: string
  /** tarkov.dev objective type (giveItem, visit, shoot…) or 'unknown'. */
  type: string
  target: number
  current: number
  /** Set when `current >= target`. */
  completedAt?: string
  source: ObjectiveSource
  /** 0…1: manual 1, log 0.95, OCR ≤ 0.8. */
  confidence: number
  observedAt: string
}

export type ProgressEventType = 'objective' | 'task-status' | 'undo' | 'conflict-resolved'

/** One recorded change of quest/objective state with its provenance (spec table `progress_events`). */
export interface ProgressEvent {
  id: string
  mode: RaidMode
  taskId: string
  objectiveId?: string
  eventType: ProgressEventType
  /** Objective: current count (null = no record). Task: status (null = no record). */
  oldValue: number | string | null
  newValue: number | string | null
  source: ObjectiveSource
  confidence: number
  observedAt: string
  /** Automatic changes can be undone from «История изменений». */
  reversible: boolean
  undoneAt?: string
  /** Event id this undo / resolution refers to. */
  refersTo?: string
  /** Already stored on the server. */
  synced?: boolean
}

/** A log-confirmed completion that would override the user's manual «not done»: applied only after asking. */
export interface ObjectiveConflict {
  objectiveId: string
  taskId: string
  incoming: ObjectiveProgress
  detectedAt: string
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
  /** «Что не продавать»: how many of each item the player says they already have (found / bought), per mode. */
  itemCounts?: Record<string, number>
  seasonId?: string
  lastLogSyncAt?: string
  logCharacterId?: string
  /** Objective state keyed by objectiveId (schema v6). */
  objectiveProgress: Record<string, ObjectiveProgress>
  /** Newest last; capped (see MAX_LOCAL_EVENTS). */
  progressEvents: ProgressEvent[]
  objectiveConflicts: ObjectiveConflict[]
}

export interface LocalProfile {
  schemaVersion: 6
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
  /** Named places of the map (tarkov.dev maps.json `labels`, game x/z), used to anchor curated markers by name. */
  labels?: Array<{ text: string; x: number; z: number }>
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
  /**
   * The data says this spawn is certain («Спавн 100 %»): a boss with a 100 % spawn chance in the loaded mode, or a quest
   * item with a single listed spawn position. Never set from guesses; loose loot has no chance in the data.
   */
  guaranteedSpawn?: boolean
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

/** A map zone of an objective in game coordinates (tarkov.dev `zones`). */
export interface ObjectiveZone {
  id?: string
  /** App map id (canonical). */
  mapId: string
  position: { x: number; y?: number; z: number }
  outline?: Array<{ x: number; y?: number; z: number }>
  top?: number
  bottom?: number
}

/** One objective of a trader task as the catalog describes it (spec table `task_objectives`). */
export interface QuestObjective {
  id: string
  type: string
  description: string
  optional?: boolean
  /** Required count (1 for yes/no objectives). */
  count: number
  itemIds?: string[]
  foundInRaid?: boolean
  mapIds?: string[]
  zones?: ObjectiveZone[]
  /** Spawn points of a quest item (findQuestItem), game coordinates. */
  itemSpots?: Array<{ mapId: string; x: number; y?: number; z: number }>
  /** Has zones or possible spots on a map (a map point); otherwise a checklist step (raid briefing). */
  zoneBound?: boolean
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
  /** An internal story objective quest belongs to its chapter, not the trader task list. */
  storyChapterId?: string
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
  /** Structured objectives (id, type, count, zones); `objectives` keeps the display lines. */
  objectiveDetails?: QuestObjective[]
  mapIds?: string[]
  anyMap?: boolean
  raidRequirements?: Array<{
    itemId: string
    count: number
    purpose: 'place' | 'mark' | 'key' | 'bring' | 'handover' | 'find'
    mapIds: string[]
    /** The item must be found in raid (tarkov.dev TaskObjectiveItem.foundInRaid). */
    foundInRaid?: boolean
    /** tarkov.dev objective id the requirement comes from. */
    objectiveId?: string
    /** Number of items the objective accepts; above 1 any of them counts (e.g. «hand over 3 of any medical»). */
    alternatives?: number
    optional?: boolean
    /** Item condition the objective accepts, in % (tarkov.dev min/maxDurability). */
    minDurability?: number
    maxDurability?: number
    dogTagLevel?: number
  }>
}

/** Raid briefing / route name for the unified objective shape. */
export type QuestObjectiveDetail = QuestObjective

export interface PriceQuote {
  source: string
  /** Roubles per item. */
  price: number
  mode: RaidMode
  updatedAt: string
  /** flea: the flea listing price; trader: what the trader pays; base: the handbook base price (no offer). Older data: by `source`. */
  kind?: 'flea' | 'trader' | 'base'
  /** Flea quotes: the current lowest offer (`lastLowPrice`) or, when there is none, the 24-hour average. */
  basis?: 'last-low' | 'avg-24h'
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
  /**
   * Flea price in the catalog's mode: the current lowest offer (tarkov.dev `lastLowPrice`); the 24-hour average only
   * when there is no current offer (`fleaPriceBasis: 'avg-24h'`). Missing for flea-banned items.
   */
  fleaPrice?: number
  fleaPriceBasis?: 'last-low' | 'avg-24h'
  /** Handbook base price (tarkov.dev `basePrice`): needed for the flea fee. */
  basePrice?: number
  wikiLink?: string
  types?: string[]
  /** Jewelry / valuables by the item's tarkov.dev categories (src/data/catalogSource.ts `isValuableItem`). */
  valuable?: boolean
  /**
   * Weapons: picture of the whole gun — tarkov.dev's default preset (properties.defaultPreset), whose 512px image
   * shows the assembled weapon; the base item's own icon is just the receiver. Missing for other items.
   */
  presetImageUrl?: string
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
    /** Structured item requirements (tarkov.dev RequirementItem); `requirements` keeps the display strings. */
    itemRequirements?: Array<{ itemId: string; count: number; foundInRaid?: boolean }>
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
    /** Upstream URL of the task data. */
    sourceUrl?: string
    /** Upstream data version (Last-Modified / ETag of the tasks file) when the server sent one. */
    sourceVersion?: string
    /** Upstream timestamp of the task data, ISO. */
    sourceUpdatedAt?: string
    /** The flea market of this mode (tarkov.dev `fleaMarket` of the items file): open or not, and its fee rates. */
    fleaMarket?: { enabled: boolean; offerFeeRate?: number; requirementFeeRate?: number }
  }
}
