export type RaidMode = 'pvp' | 'pve'
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
  | 'landmark'
export type ExtractFaction = 'pmc' | 'scav' | 'coop' | 'unknown'
export type TaskProgressStatus = 'unknown' | 'locked' | 'available' | 'active' | 'completed' | 'failed'
export type ProgressSource = 'manual' | 'eft-log' | 'profile-import' | 'backup' | 'migration'

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
}

export interface ModeProgress {
  playerLevel: number
  faction: 'usec' | 'bear' | 'unknown'
  prestige: number
  taskProgress: Record<string, TaskProgressRecord>
  trackedTaskIds: string[]
  favoriteItemIds: string[]
  hideoutLevels: Record<string, number>
}

export interface LocalProfile {
  schemaVersion: 2
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
  transform?: [number, number, number, number]
  coordinateRotation?: number
  tileSize?: number
  minZoom?: number
  maxZoom?: number
  accent: string
  floors?: string[]
  layers?: Array<{ id?: string; name: string; imageUrl?: string; tileUrl?: string; heightRange?: [number, number] }>
  markerCount: number
  attribution?: string
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
  questId?: string
  itemId?: string
  extractId?: string
  extractFaction?: ExtractFaction
  source?: string
  requiresPower?: boolean
  requiresItem?: boolean
  requiresCoop?: boolean
  meta?: string
}

export interface Quest {
  id: string
  normalizedName?: string
  name: string
  trader: string
  mapId?: string
  level: number
  kappa: boolean
  description: string
  objectives: string[]
  rewards: string[]
  requiredItems?: string[]
  previous?: string[]
  requirements?: TaskRequirement[]
  faction?: string
  experience?: number
  wikiLink?: string
  imageUrl?: string
  objectiveIds?: string[]
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
  level: number
  status: 'ready' | 'progress' | 'locked'
  requirements: string[]
  bonus: string
  maxLevel?: number
  imageUrl?: string
}

export interface Trader {
  id: string
  name: string
  role: string
  loyalty: number
  accent: string
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
