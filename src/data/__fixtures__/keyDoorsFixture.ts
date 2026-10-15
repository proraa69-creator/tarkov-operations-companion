import type { GameMap, Item, MapMarker } from '../../domain/types'
import { maps as demoMaps } from '../demo'

/** Keys of the «Барахолка» door tests: one door, several doors (Factory exit key), none, and a Labs keycard. */
export const DORM_KEY_ID = '5938603e86f77435642354f4'
export const FACTORY_KEY_ID = '5448ba0b4bdc2d02308b456c'
export const NO_DOOR_KEY_ID = '5780cf7f2459777de4559322'
export const RED_CARD_ID = '5c1d0efb86f7744baf2e7b7b'
export const STORAGE_CARD_ID = '66acd6702b17692df20144c0'

const key = (id: string, name: string, shortName: string): Item => ({ id, name, shortName, category: 'Ключ', description: '', prices: [] })
export const keyItems: Item[] = [
  key(DORM_KEY_ID, 'Ключ от комнаты 206 общежития', '206'),
  key(FACTORY_KEY_ID, 'Ключ от аварийного выхода с завода', 'Завод'),
  key(NO_DOOR_KEY_ID, 'Ключ от комнаты 314 (Тестовый)', '314'),
  key(RED_CARD_ID, 'Ключ-карта TerraGroup Labs (Красная)', 'Красная'),
  key(STORAGE_CARD_ID, 'Ключ-карта склада TerraGroup', 'Склад'),
]

/** Factory with real floors: the 2nd floor is a layer above the main level. */
export const factoryMap: GameMap = {
  ...demoMaps.find((map) => map.id === 'factory')!,
  floors: ['Основной', '2 этаж', '3 этаж', 'Тоннели'],
  layers: [
    { id: 'main', name: 'Основной', svgLayer: 'Ground_Floor', heightRange: [-1, 3], ownTiles: true },
    { id: 'layer-0', name: '2 этаж', svgLayer: 'Second_Floor', extents: [{ height: [3, 6] }] },
    { id: 'layer-1', name: '3 этаж', svgLayer: 'Third_Floor', extents: [{ height: [6, 10000] }] },
    { id: 'layer-2', name: 'Тоннели', svgLayer: 'Basement', extents: [{ height: [-10000, -1] }] },
  ],
}
export const keyMaps: GameMap[] = demoMaps.map((map) => (map.id === 'factory' ? factoryMap : map))

const lock = (mapId: string, id: string, keyId: string, keyName: string, position: [number, number], extra: Partial<MapMarker> = {}): MapMarker => ({
  id: `${mapId}-lock-${id}`,
  mapId,
  type: 'key',
  layerId: 'key',
  title: `Дверь · открывает: ${keyName}`,
  description: `Нужен ключ «${keyName}».`,
  position,
  itemId: keyId,
  lock: { keyId, keyName, kind: 'door' },
  source: 'json.tarkov.dev/maps',
  ...extra,
})

export const keyMarkers: MapMarker[] = [
  lock('customs', 'dorm-206', DORM_KEY_ID, 'Ключ от комнаты 206 общежития', [150, 180]),
  // The Factory exit key: three Factory doors (one on the 2nd floor) and a truck cab on Lighthouse it does not open.
  lock('factory', 'gate-3', FACTORY_KEY_ID, 'Ключ от аварийного выхода с завода', [60, 20], { floor: 'Основной', height: 1 }),
  lock('factory', 'office', FACTORY_KEY_ID, 'Ключ от аварийного выхода с завода', [40, 10], { floor: '2 этаж', height: 4 }),
  lock('factory', 'cellar', FACTORY_KEY_ID, 'Ключ от аварийного выхода с завода', [-50, 30], { floor: 'Основной', height: 0.5 }),
  lock('lighthouse', 'truck', FACTORY_KEY_ID, 'Ключ от аварийного выхода с завода', [10, 10], { lock: { keyId: FACTORY_KEY_ID, keyName: 'Ключ от аварийного выхода с завода', kind: 'trunk' } }),
  // A Labs keycard reader and a car door of the storage keycard on two maps.
  lock('the-lab', 'red', RED_CARD_ID, 'Ключ-карта TerraGroup Labs (Красная)', [-300, -250], { lock: { keyId: RED_CARD_ID, keyName: 'Ключ-карта TerraGroup Labs (Красная)', keycard: 'red', needsPower: true, kind: 'door' } }),
  lock('factory', 'storage', STORAGE_CARD_ID, 'Ключ-карта склада TerraGroup', [20, -20], { floor: 'Тоннели', height: -3 }),
  lock('customs', 'storage-car', STORAGE_CARD_ID, 'Ключ-карта склада TerraGroup', [100, 100], { lock: { keyId: STORAGE_CARD_ID, keyName: 'Ключ-карта склада TerraGroup', kind: 'trunk' } }),
  // Not a lock: a loot marker with an item id never makes a door.
  { id: 'customs-loot-1', mapId: 'customs', type: 'cache', layerId: 'loot.valuable', title: 'Драгоценности', description: '', position: [1, 1], itemId: NO_DOOR_KEY_ID },
]
