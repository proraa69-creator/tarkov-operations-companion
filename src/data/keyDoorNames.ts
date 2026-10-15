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

export const KEY_DOOR_PLACES: KeyDoorPlace[] = [
  // TerraGroup Labs keycard (Black): «the laboratory experiment's area (G12) on the first level» and «Kruglov's office (R22)
  // and its safe on the second level». tarkov.dev has two lock points in each (4.3 m and 7.5 m apart).
  { keyId: BLACK_KEYCARD_ID, mapId: 'the-lab', x: -130.84, y: 1.41, z: -349.32, radius: 4, ru: 'Зона экспериментов (G12)', en: 'Experiment area (G12)' },
  { keyId: BLACK_KEYCARD_ID, mapId: 'the-lab', x: -265.12, y: 5.3, z: -372.68, radius: 5, ru: 'Кабинет Круглова (R22)', en: "Kruglov's office (R22)" },
  // Factory emergency exit key: «two additional extractions and a locked room next to the office on Factory» — the doors
  // nearest the Med Tent Gate and Cellars extracts and the room on the 3rd office floor (y 9, the «Always sunny» zone of
  // «Is This a Reference?»).
  { keyId: FACTORY_EXIT_KEY_ID, mapId: 'factory', x: -19.08, y: 1.45, z: -48.57, radius: 2, ru: 'Ворота у медицинской палатки (выход)', en: 'Med Tent Gate (extract)' },
  { keyId: FACTORY_EXIT_KEY_ID, mapId: 'factory', x: 66.83, y: -1.61, z: -29.32, radius: 2, ru: 'Подвалы (выход)', en: 'Cellars (extract)' },
  { keyId: FACTORY_EXIT_KEY_ID, mapId: 'factory', x: 29.12, y: 9.08, z: 36.52, radius: 2, ru: 'Комната на 3 этаже офисов', en: 'Office room, 3rd floor' },
  // USEC cottage second safe key: «a safe in the south-western bedroom on the second floor of the blue chalet» (its only
  // Lighthouse lock point).
  { keyId: USEC_COTTAGE_SECOND_SAFE_KEY_ID, mapId: 'lighthouse', x: -81.35, y: 22.33, z: -57.37, radius: 2, ru: 'Сейф в синем шале', en: 'Safe, blue chalet' },
]

/** The named place of a key's lock point (game x / z, height y), if the wiki names it. */
export function keyDoorPlace(keyId: string, mapId: string, x: number, z: number, y: number | undefined): KeyDoorPlace | undefined {
  return KEY_DOOR_PLACES.find((place) => place.keyId === keyId
    && place.mapId === mapId
    && Math.hypot(place.x - x, place.z - z) <= place.radius
    && (y == null || Math.abs(place.y - y) <= PLACE_LEVEL_METRES))
}
