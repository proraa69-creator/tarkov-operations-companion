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
/**
 * `manual-fix`: «Ручная отметка» (owner, 15.10.2026), the player's own mark for a quest a bug got wrong. `manual`: the
 * marks of versions before 0.5 (nothing creates them now).
 */
export type ProgressSource = 'manual' | 'manual-fix' | 'eft-log' | 'profile-import' | 'backup' | 'migration' | 'inferred' | 'screen-scan'

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
  /** An `eft-log` decision taken from the server's records (another PC's logs), src/quests/questEngine.ts. */
  origin?: 'server'
  inferredFromTaskId?: string
  currentStageIndex?: number
  /** Latest visible objectives, not a prediction from the chapter's sequence. */
  storyObjectives?: StoryObjectiveReading[]
}

// The quest-state engine's inputs (src/quests/questEngine.ts), kept per mode in ModeProgress.questInputs.
/** One source's word on a quest: its status and when it was seen (ISO, UTC). */
export interface QuestObservation { status: 'active' | 'completed' | 'failed'; at: string }
/** A manual mark: `cleared` is «Снять отметку», kept as a tombstone so it syncs too. */
export interface ManualMark { status: 'active' | 'completed' | 'cleared'; at: string }

/** What each source said, per quest id, never merged (ModeProgress.questInputs). */
export interface QuestInputLayers {
  log: Record<string, QuestObservation>
  server: Record<string, QuestObservation>
  manual: Record<string, ManualMark>
  /** Tasks-table readings (source 'screen-scan'): PvE only. */
  table: Record<string, TaskProgressRecord>
  /** Story-pane readings of chapters (source 'screen-scan'): stage and objectives. */
  story: Record<string, TaskProgressRecord>
  /** `manual` records of older versions. */
  legacy: Record<string, TaskProgressRecord>
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

/**
 * Where the mode's level last came from (owner, 13.10.2026: «побеждают свежие, но приоритет у тарков дев»): the newer
 * reading wins; Tarkov.dev keeps the anchor when the game's screen shows the same level (it knows the exact experience).
 */
export interface LevelAnchor {
  level: number
  /** When the level was true: the game's screen at that moment, or Tarkov.dev's update time of the profile. */
  observedAt: string
  source: 'screen' | 'tarkov-dev'
  /**
   * A screen reading whose digits were also read from their shapes (src/import/levelDigits.ts). Readings stored before
   * 14.10.2026 were OCR alone, which took the game's «3» for a «5» (PvE 39 shown as 59): any newer reading replaces those.
   */
  checked?: true
  /** Total experience (Tarkov.dev only): quest experience after the anchor adds to it. */
  experience?: number
}

export interface ModeProgress {
  registration: ModeRegistration
  playerSnapshot?: PlayerProfileSnapshot
  playerLevel: number
  /** The level's source and time; `playerLevel` may be higher by the experience of quests completed since. */
  levelAnchor?: LevelAnchor
  faction: 'usec' | 'bear' | 'unknown'
  prestige: number
  /**
   * Since when `prestige` is the player's own value: the level chosen in «Престиж +» (owner, 15.10.2026). A later game
   * reading (Tarkov.dev) after it may raise it, never lower it. Undefined: the prestige is Tarkov.dev's.
   */
  prestigeSetAt?: string
  /**
   * The quest-state engine's output (src/quests/questEngine.ts resolveQuestStates over `questInputs`): written only by
   * it, read by everything. Kept in the stored profile so older readers work.
   */
  taskProgress: Record<string, TaskProgressRecord>
  /** What each quest source said, kept apart (src/quests/questInputs.ts). Missing in profiles of 0.6.0.41 and older. */
  questInputs?: QuestInputLayers
  trackedTaskIds: string[]
  favoriteItemIds: string[]
  raidItemIds: string[]
  hideoutLevels: Record<string, number>
  /** «Что не продавать»: how many of each item the player says they already have (found / bought), per mode. */
  itemCounts?: Record<string, number>
  seasonId?: string
  lastLogSyncAt?: string
  logCharacterId?: string
  /** The latest trusted profile reset of this character the records were cut at (src/import/logApply.ts logEpochChange). */
  logResetAt?: string
  /**
   * When the mode's current character or the history since its last reset began (a character change or a trusted reset,
   * src/import/logApply.ts): every quest, story and objective record older than this was dropped then. Undefined until one.
   */
  logEpochAt?: string
  /**
   * The floor of 0.6.0.40/41: «Престиж +» or a nickname change at the press. No longer written (owner, 15.10.2026: «нужно
   * что бы приложение находило все актуальные на данный момент квесты, даже если просто сделали сброс приложения, а в
   * игре нет»): a profile that has one gets a pending `resetMarker` instead at load (src/domain/progress.ts).
   */
  modeResetAt?: string
  /**
   * «Престиж +» / «Вайп» / a new nickname: the player says the game's profile was reset around `at`. While pending, the
   * logs before it still count (it may be an app-only reset); the game's own reset after it in the logs (a new profile id,
   * a quest taken again after its hand-in, the prestige / new-profile request) becomes the floor and resolves it
   * (`resolvedAt`). src/state/AppState.tsx applyLogState.
   */
  resetMarker?: { kind: 'prestige' | 'wipe' | 'nickname'; at: string; resolvedAt?: string }
  /**
   * The times of this app's reset presses (newest last, a few): a server that still answers one of them as a «reset»
   * (0.6.0.41's floors) is not taken for the game's own reset.
   */
  appResetTimes?: string[]
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
  /** tarkov.dev `lockType`: a door, a car door / trunk, or a locked container. */
  kind?: 'door' | 'trunk' | 'container'
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
  /**
   * The owner's description of a quest point «где и что искать» in the app's language, and the curated requirements
   * linked to this point (src/data/questPointOverrides.ts, src/data/questRequirementOverrides.ts).
   */
  hint?: MarkerHint
}

/** What the owner wrote for players at a quest point. */
export interface MarkerHint {
  title?: string
  text?: string
  /** Items / keys the owner linked to this point (resolved names, for the tooltip). */
  needs?: Array<{ itemId: string; name: string; iconUrl?: string; kind: string; count: number }>
}

/** A quest point's description, gathered on the quest for its card (objective / stage it belongs to). */
export interface QuestPointHint {
  markerId: string
  mapId: string
  objectiveId?: string
  stageIndex?: number
  title?: string
  text: string
}

/** Kinds of the requirements the owner adds in the quest constructor (src/data/questRequirementOverrides.ts). */
export type CuratedRequirementKind = 'bring' | 'handover' | 'find' | 'key' | 'plant' | 'use'

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
  /** buildWeapon objectives (Механик, «Оружейник»): the weapon to modify, the parts it must hold and its stats. */
  build?: WeaponBuildRequirement
  /**
   * What a kill objective asks of the player's gear and the kill (tarkov.dev TaskObjectiveShoot: `usingWeapon`,
   * `usingWeaponMods`, `wearing`, `notWearing`, `distance`, `bodyParts`, `timeFromHour`…); src/data/objectiveConditions.ts.
   * The objective's `count`, `mapIds` and `zones` stay where they are.
   */
  conditions?: ObjectiveConditions
  /** A transit objective («Совершить переход с Улиц Таркова на Лабораторию»): the transit it is done at (src/data/questTransits.ts). */
  transit?: QuestObjectiveTransit
}

/**
 * An item a condition names: its id (the picture comes from the catalog's item of that id, or tarkov.dev's
 * `<id>-icon.webp`) and its name in the catalog's language. No full item: the quest base stays small.
 */
export interface ItemRef {
  id: string
  name: string
}

/**
 * The conditions of a kill objective (tarkov.dev TaskObjectiveShoot), compact. Alternatives as the game stores them
 * (BSG `weaponModsInclusive` / `equipmentInclusive`): `mods` and `wearing` are a list of options — any one option will
 * do, and every item of that option is needed («AK-12 with the suppressor AND the PS-320» is one option of two items;
 * «any suppressor» is thirty options of one). Only what tarkov.dev has; nothing is guessed.
 */
export interface ObjectiveConditions {
  /** Any one of these weapons (`usingWeapon`). */
  weapons?: ItemRef[]
  /** Weapon parts: any one option, all of its items (`usingWeaponMods`). */
  mods?: ItemRef[][]
  /** Gear to wear: any one option, all of its items (`wearing`). */
  wearing?: ItemRef[][]
  /** Gear that must not be worn: none of these (`notWearing`). */
  notWearing?: ItemRef[]
  /** Distance to the target in metres (`distance`, when its value is above 0). */
  distance?: { compare: '>=' | '<='; value: number }
  /** Body parts that count (`bodyParts`): `key` is the game's part (Head, Chest…), `name` the catalog's word for it. */
  bodyParts?: Array<{ key: string; name: string }>
  /** The targets (`targetNames`): `key` is the game's role (AnyPmc, Savage, Any, a boss…), `name` the catalog's text. */
  targets?: Array<{ key: string; name: string }>
  /** Named zones of the objective (GraphQL `zoneNames`; the JSON feed has only the zones' shapes, `QuestObjective.zones`). */
  zoneNames?: string[]
  /** In-game hours (`timeFromHour`–`timeUntilHour`, both 0 = any time). */
  time?: { from: number; until: number }
  /** A hit is enough (`shotType: hit`); otherwise the target is killed. */
  hitOnly?: boolean
  /** The target must be under these effects (`enemyHealthEffect`, e.g. stunned). */
  enemyEffects?: string[]
  /** The player must be under these effects (`playerHealthEffect`, e.g. a stimulant). */
  playerEffects?: string[]
}

/** Where a transit objective is done: the map, the map it leads to and the transit's id in the tarkov.dev maps file. */
export interface QuestObjectiveTransit {
  fromMapId: string
  toMapId: string
  transitId?: string
}

/** A stat a modified weapon must reach (tarkov.dev `attributes` of a buildWeapon objective), e.g. ergonomics ≥ 50. */
export interface WeaponBuildAttribute {
  /** tarkov.dev name: ergonomics, recoil, weight, magazineCapacity, effectiveDistance, durability, accuracy… */
  name: string
  compare: '>=' | '<=' | '>' | '<' | '='
  value: number
}

/** What a buildWeapon objective asks for (tarkov.dev TaskObjectiveBuildItem). */
export interface WeaponBuildRequirement {
  /** Item id of the weapon to modify. */
  weaponId: string
  /** Every one of these parts must be installed (containsAll). */
  partIds: string[]
  /** At least one of these must be installed (containsOne, older data). */
  anyOfIds?: string[]
  /** A part of each of these categories must be installed (containsCategory). */
  categories?: Array<{ id: string; name: string }>
  attributes: WeaponBuildAttribute[]
  /** A ready build of this weapon that passes the task: tarkov.help's guide, else the wiki's table (src/data/buildGuides.ts). */
  guide?: BuildGuide
}

/** A build that passes a Gunsmith task, as a guide site lists it: the parts to put on the weapon and who sells them. */
export interface BuildGuide {
  source: 'tarkov.help' | 'wiki'
  /** The guide's page. */
  url?: string
  /** The game's «Сборки оружия» screen with this build finished (tarkov.help). */
  image?: string
  parts: BuildGuidePart[]
}

/** One part of a build guide: the item, whether it must be installed, who sells it. */
export interface BuildGuidePart {
  /** Catalog item id; missing when the catalog has no item by the guide's name. */
  itemId?: string
  /** The guide's item name (the wiki's is English). */
  name: string
  required?: boolean
  /** Trader key (tarkov.dev normalizedName) and the loyalty level; `barter` for a barter. */
  sellers: Array<{ trader: string; level: number; barter?: boolean }>
  /** Sold on the flea only (tarkov.help «Цена в барахолке»). */
  fleaOnly?: boolean
  /** Not sold anywhere (tarkov.help «Нельзя купить»): found in raid or from a task. */
  notSold?: boolean
}

/**
 * How a task opens besides its previous tasks (tarkov.dev `otherRequirements`, src/data/questGrid.ts). Since the 2026
 * versions of the game most trader tasks open by a trader «ветка» (a game variable) reaching a level: «Дефицит» at level 1
 * of Therapist's first line, «Осеннее недомогание» at level 4 of it. A trader's first tasks are given in a dialogue.
 */
export interface QuestUnlock {
  /** `id` = the game variable; `level` = the value it must reach; `order` / `ll` = the line's place among the trader's lines and its loyalty level (tarkov.help). */
  lines?: Array<{ id: string; level: number; order?: number; ll?: number }>
  dialogue?: boolean
}

/** tarkov.help's view of a task (src/data/questGrid.snapshot.json): its loyalty level, level and previous tasks there. */
export interface QuestHelpView {
  ll?: number
  level?: number
  kappa?: boolean
  /** Previous tasks there that the game has (task ids) and that it no longer has (names). */
  after?: string[]
  afterNames?: string[]
  /** tarkov.help's name when it is not the game's. */
  name?: string
}

export interface Quest {
  id: string
  normalizedName?: string
  /** The title in the app's language. */
  name: string
  /**
   * The title as the game shows it in Russian and in English, whatever the app's language: the screen reader matches
   * both, so a Russian game read by the English app (or the other way round) still finds its quests (product roadmap:
   * «Quest counts must not change when switching interface language»). Absent from catalogs that do not carry them.
   */
  nameRu?: string
  nameEn?: string
  /** Other titles the game has shown for this quest (renames, the owner's corrections), for the same matching. */
  ocrAliases?: string[]
  trader: string
  /** The trader's game id (tarkov.dev), when known. */
  traderId?: string
  /** Line and dialogue conditions (src/data/questGrid.ts). */
  unlock?: QuestUnlock
  /** tarkov.help's view of the task, for the chronology and the comparison (src/data/questGrid.ts). */
  helpView?: QuestHelpView
  /**
   * Trader loyalty the task tells about (tarkov.dev, by trader id): `needed` to take it (`traderRequirements` of type
   * level), `reached` once it is completed (its «reach loyalty level N» objectives). Used to estimate the player's levels.
   */
  traderLoyalty?: { needed: Array<{ traderId: string; level: number }>; reached: Array<{ traderId: string; level: number }> }
  /**
   * The game's own conditions of the task that the app cannot see (tarkov.dev `otherRequirements`): a talk with the trader
   * (`dialogue`) or a hidden progress counter of the trader's tasks (`progress`, a `globalVariable`). Such a task is never
   * «available» on a guess, only once the game logs have it (src/progression/requirementEngine.ts; owner, 12.10.2026:
   * Mechanic was still closed in the season, yet the Overview offered «Оружейник. АКС-74Н»). `badStanding`: the trader
   * gives it only below a reputation (`traderRequirements` of type reputation, `<` / `<=`: Fence's «Возмещение ущерба»
   * at −1 and below; owner, 16.10.2026: offered at Fence 0.44).
   */
  gameConditions?: Array<'dialogue' | 'progress' | 'badStanding'>
  /**
   * The quest's data was corrected by hand from a checked source (src/data/questCorrections.ts) and is pinned: catalog
   * and server updates do not overwrite it.
   */
  manualCorrection?: { source: string; checkedAt: string }
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
    /**
     * Added or corrected by the owner in the quest constructor («добавлено Raid OS»): its own kind, comment and the point
     * it is tied to; `replaced` when it corrects the catalog's requirement of the same item and kind.
     */
    curated?: { id: string; kind: CuratedRequirementKind; comment?: string; pointId?: string; replaced?: boolean }
  }>
  /** The owner's point descriptions «где искать» of this quest (src/data/questPointOverrides.ts). */
  pointHints?: QuestPointHint[]
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
  /** tarkov.dev normalized name (prapor, mechanic, …), the key of trader offers. */
  normalizedName?: string
  /** Player level each loyalty level needs: index 0 = level 1 (tarkov.dev `levels[].requiredPlayerLevel`). */
  levelPlayerLevels?: number[]
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
    /**
     * Desktop app: the server's version of this catalog's content (its ETag, electron/serviceGateway.ts). The next
     * request sends it back and gets «not modified» while nothing changed (src/data/tarkovJsonClient.ts).
     */
    contentVersion?: string
    /**
     * The server's quest base this catalog comes from (server/src/services/questBase.ts): a content hash of the mode's
     * Russian and English snapshots, so the same in both languages. Quest ids and titles are the same for every
     * reader of one version. Absent from catalogs built on this device.
     */
    questBaseVersion?: string
  }
}
