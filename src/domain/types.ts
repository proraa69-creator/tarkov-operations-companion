export type RaidMode = 'pvp' | 'pve'
export type MarkerType = 'quest' | 'extract' | 'key' | 'boss' | 'spawn' | 'cache' | 'danger' | 'landmark'

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
  layers?: Array<{ name: string; imageUrl?: string; tileUrl?: string }>
  markerCount: number
  attribution?: string
}

export interface MapMarker {
  id: string
  mapId: string
  type: MarkerType
  title: string
  description: string
  position: [number, number]
  floor?: string
  questId?: string
  itemId?: string
  meta?: string
}

export interface Quest {
  id: string
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
}

export interface PriceQuote {
  source: string
  price: number
  mode: RaidMode
  updatedAt: string
}

export interface Item {
  id: string
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
}

export interface HideoutStation {
  id: string
  name: string
  level: number
  status: 'ready' | 'progress' | 'locked'
  requirements: string[]
  bonus: string
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
}
