/**
 * Names of the places a key opens, where the EFT wiki (EN / RU fandom key pages, «Lock locations» / «Что открывает»,
 * read 15.10.2026) leaves no doubt which tarkov.dev lock point is which: the list in «Барахолка» then shows
 * «Завод · Подвалы (выход)» instead of «Дверь 2». Only names are curated here, never positions: a place is matched to the
 * lock points tarkov.dev gives (maps.json `locks`), and every lock point of one key inside one place is one entry.
 */
export interface KeyDoorPlace {
  keyId: string
  /** Canonical map id (src/data/mapIds.ts). */
  mapId: string
  /** Game x / y / z of the place: the tarkov.dev lock point (or the middle of the lock points) of that room. */
  x: number
  y: number
  z: number
  /** Lock points of this key closer than this (horizontally, metres) and on the same level belong to the place. */
  radius: number
  ru: string
  en: string
}

/** Lock points more than this apart in height are on different levels. */
const PLACE_LEVEL_METRES = 2

export const BLACK_KEYCARD_ID = '5c1d0f4986f7744bb01837fa'
export const FACTORY_EXIT_KEY_ID = '5448ba0b4bdc2d02308b456c'
export const USEC_COTTAGE_SECOND_SAFE_KEY_ID = '61aa5ba8018e9821b7368da9'
export const CARDINAL_APARTMENT_KEY_ID = '68c165f1903341d88b092b2a'

export const KEY_DOOR_PLACES: KeyDoorPlace[] = [
  // TerraGroup Labs keycard (Black) on The Lab: the owner (15.10.2026): «на лаборатории ключ-карта открывает две двери
  // рядом, в одно и то же помещение» — the two lock points of the experiment area G12 on level 1 (4.3 m apart), each its
  // own entry. (Kruglov's office R22 is excluded below.)
  { keyId: BLACK_KEYCARD_ID, mapId: 'the-lab', x: -128.79, y: 1.41, z: -349.92, radius: 1.5, ru: 'Зона экспериментов (G12) — дверь 1', en: 'Experiment area (G12) — door 1' },
  { keyId: BLACK_KEYCARD_ID, mapId: 'the-lab', x: -132.89, y: 1.41, z: -348.72, radius: 1.5, ru: 'Зона экспериментов (G12) — дверь 2', en: 'Experiment area (G12) — door 2' },
  // Factory emergency exit key: the owner (15.10.2026): «у него всего 5 точек открытия» — three on Factory (the doors
  // nearest the Cellars and Med Tent Gate extracts and the room on the 3rd office floor, EFT wiki) and two at the Customs
  // guard building (KEY_DOOR_EXTRA_LOCKS).
  { keyId: FACTORY_EXIT_KEY_ID, mapId: 'factory', x: 66.83, y: -1.61, z: -29.32, radius: 2, ru: 'Вход в подвалы', en: 'Cellars entrance' },
  { keyId: FACTORY_EXIT_KEY_ID, mapId: 'factory', x: -19.08, y: 1.45, z: -48.57, radius: 2, ru: 'Запасной выход медицинской палатки', en: 'Med tent emergency exit' },
  { keyId: FACTORY_EXIT_KEY_ID, mapId: 'factory', x: 29.12, y: 9.08, z: 36.52, radius: 2, ru: 'Запертая комната', en: 'Locked room' },
  { keyId: FACTORY_EXIT_KEY_ID, mapId: 'customs', x: 356.98, y: 2.14, z: -8.04, radius: 1.5, ru: 'Здание охраны — дверь 1', en: 'Guard building — door 1' },
  { keyId: FACTORY_EXIT_KEY_ID, mapId: 'customs', x: 356.05, y: 2.34, z: -14.57, radius: 1.5, ru: 'Здание охраны — дверь 2', en: 'Guard building — door 2' },
  // USEC cottage second safe key: «a safe in the south-western bedroom on the second floor of the blue chalet» (its only
  // Lighthouse lock point).
  { keyId: USEC_COTTAGE_SECOND_SAFE_KEY_ID, mapId: 'lighthouse', x: -81.35, y: 22.33, z: -57.37, radius: 2, ru: 'Сейф в синем шале', en: 'Safe, blue chalet' },
]

/** Tarkov.dev lock points of a key that the key does not open: dropped from the index. Every given field must match. */
export interface KeyDoorExclusion {
  keyId: string
  /** Canonical map id (src/data/mapIds.ts); absent: every map. */
  mapId?: string
  /** Only locks of this kind (tarkov.dev `lockType`). */
  kind?: 'door' | 'trunk' | 'container'
  /** Game x / y / z; lock points within `radius` metres horizontally and on the same level. */
  point?: { x: number; y: number; z: number; radius: number }
}

export const KEY_DOOR_EXCLUSIONS: KeyDoorExclusion[] = [
  // TerraGroup Labs keycard (Black): tarkov.dev and the wiki give it Kruglov's office R22 on level 2 (its door and safe, two
  // lock points 7.5 m apart), but the owner (15.10.2026): «больше точек нет» — the card has exactly three points, the two
  // G12 doors on The Lab and the Cardinal apartment safe on Streets.
  { keyId: BLACK_KEYCARD_ID, mapId: 'the-lab', point: { x: -265.12, y: 5.3, z: -372.68, radius: 5 } },
  // Factory emergency exit key: tarkov.dev (15.10.2026) still lists 17 truck cabs on Lighthouse, Streets, Shoreline and
  // Ground Zero (`trunk`), but the owner: «у него всего 5 точек открытия» — no vehicles.
  { keyId: FACTORY_EXIT_KEY_ID, kind: 'trunk' },
]

/** Whether a key's lock point (game x / z, height y) is excluded (KEY_DOOR_EXCLUSIONS). */
export function keyDoorExcluded(keyId: string, mapId: string, x: number, z: number, y: number | undefined, kind: string = 'door') {
  return KEY_DOOR_EXCLUSIONS.some((rule) => rule.keyId === keyId
    && (!rule.mapId || rule.mapId === mapId)
    && (!rule.kind || rule.kind === kind)
    && (!rule.point || (Math.hypot(rule.point.x - x, rule.point.z - z) <= rule.point.radius
      && (y == null || Math.abs(rule.point.y - y) <= PLACE_LEVEL_METRES))))
}

/**
 * Locks a key opens that the current tarkov.dev feed lost, kept from an older tarkov.dev maps feed (its own lock id and
 * position, never invented): src/data/mapMarkerAdapter.ts adaptLocks adds them as lock markers of their map, so the index,
 * the map's «Двери» layer and MapsPage `?lock=` treat them like any other lock.
 */
export interface KeyDoorExtraLock {
  /** tarkov.dev lock id. */
  id: string
  keyId: string
  /** Canonical map id (src/data/mapIds.ts). */
  mapId: string
  lockType: 'door' | 'trunk' | 'container'
  position: { x: number; y: number; z: number }
  top: number
  bottom: number
}

export const KEY_DOOR_EXTRA_LOCKS: KeyDoorExtraLock[] = [
  // Factory emergency exit key, the Customs guard building (the outer door, then the inner one): json.tarkov.dev maps of
  // 29.09.2026. Patch 1.2.0.0.47888 (6.10.2026) unlocked the outer door and moved the inner one to the guard post key, but
  // the owner (15.10.2026) counts both among the key's five points.
  { id: '2e9c51a0f9edec820a4b1e7fd616b5a55d5e95e5', keyId: FACTORY_EXIT_KEY_ID, mapId: 'customs', lockType: 'door', position: { x: 356.97995, y: 2.139563, z: -8.04321 }, top: 2.75381327, bottom: 1.98731291 },
  { id: 'ac28b0e35e05bf59e86bd23e39cb471a9ceec5b3', keyId: FACTORY_EXIT_KEY_ID, mapId: 'customs', lockType: 'door', position: { x: 356.052551, y: 2.34000254, z: -14.5693521 }, top: 2.76500273, bottom: 1.93500257 },
]

/** The named place of a key's lock point (game x / z, height y), if the wiki names it. */
export function keyDoorPlace(keyId: string, mapId: string, x: number, z: number, y: number | undefined): KeyDoorPlace | undefined {
  return KEY_DOOR_PLACES.find((place) => place.keyId === keyId
    && place.mapId === mapId
    && Math.hypot(place.x - x, place.z - z) <= place.radius
    && (y == null || Math.abs(place.y - y) <= PLACE_LEVEL_METRES))
}

/**
 * A lock tarkov.dev does not list for a key, placed on the lock of another key that leads to it: the entry opens the map on
 * that key's lock point (its first by marker id), so the position, map and floor stay tarkov.dev's, never invented here.
 */
export interface KeyDoorVia {
  keyId: string
  /** The key whose tarkov.dev lock on `mapId` stands for the place. */
  viaKeyId: string
  /** Canonical map id (src/data/mapIds.ts). */
  mapId: string
  ru: string
  en: string
  /** A short player-facing hint: how to reach the lock there. */
  hint?: { ru: string; en: string }
}

export const KEY_DOORS_VIA: KeyDoorVia[] = [
  // TerraGroup Labs keycard (Black): «the keycard panel behind the painting for the locked safe in the locked bedroom inside
  // apartment 2 on the second floor of the Cardinal apartment complex» (EN / RU wiki; the owner, 15.10.2026: one point of
  // the black card is on Streets). tarkov.dev has no lock for it; the Cardinal apartment key's lock (the apartment door or
  // its bedroom door) marks the apartment, not the exact panel.
  { keyId: BLACK_KEYCARD_ID, viaKeyId: CARDINAL_APARTMENT_KEY_ID, mapId: 'streets-of-tarkov', ru: 'Квартира «Кардинал» — сейф (панель ключ-карты)', en: 'Cardinal apartment — safe (keycard panel)',
    // The owner, 15.10.2026: «Открывается после сдвига картины».
    hint: { ru: 'Квартира «Кардинал»: сдвиньте картину — за ней панель ключ-карты и сейф', en: 'Cardinal apartment: move the painting — the keycard panel and safe are behind it' } },
]
