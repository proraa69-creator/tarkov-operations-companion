import type { KeySpotPhoto } from './extraKeySpots'

/**
 * «100 % спавн» (owner, 09.11.2026: «где 100% лежит конкретный предмет… не квестовые предметы, а предметы для барахолки,
 * убежища»). Loose loot is placed by the game server, so the game files cannot tell; these come from the statistics of live
 * raids (SPT database looseLoot.json: `spawnpointsForced` and the always-spawn groups), checked against tarkov.dev spots.
 * Quest items and seasonal event items are left out. Only three ordinary items spawn every raid.
 */
export interface GuaranteedSpawn {
  mapId: string
  itemId: string
  /** Shown when the feed has no such item. */
  name: string
  /** `here`: always at this one spot. `one-of`: one per raid, at one of the spots. */
  kind: 'here' | 'one-of'
  positions: ReadonlyArray<{ x: number; y: number; z: number }>
  /** Where exactly it lies, for the card (owner, 23.11.2026: «Он лежит в куртке. Это нужно пометить, записать»). */
  text?: string
  /** Our own frames of the spot (the offline game, src/assets/key-spots). */
  photos?: readonly KeySpotPhoto[]
}

export const GUARANTEED_SPAWNS: readonly GuaranteedSpawn[] = [
  // Report 121 (owner, 11.11.2026: «добавь спавн ключ от спецтехники и еще всякие разные ключи»): the two containers live raids
  // always find a key in (SPT database staticLoot.json, 11.11.2026; every other container holds a key in a quarter of raids at most).
  // «Ключ от спецтехники»: the jacket on the dorms' second floor, Customs (container 5937ef2b86f77408a47244b3).
  {
    mapId: 'customs',
    itemId: '5937ee6486f77408994ba448',
    name: 'Ключ от спецтехники',
    kind: 'here',
    positions: [{ x: 179.38, y: 3.92, z: 151.08 }],
    text: 'Лежит в куртке в каждом рейде.',
  },
  // «Ключ от офиса учёных TerraGroup»: the dead lab assistant, Ground Zero (container 6582e6c6edf14c4c6023adf2).
  {
    mapId: 'ground-zero',
    itemId: '658199aa38c79576a2569e13',
    name: 'Ключ от офиса учёных TerraGroup',
    kind: 'here',
    positions: [{ x: -59.38, y: 24.42, z: 26.49 }],
  },
  {
    mapId: 'streets-of-tarkov',
    itemId: '63a39e1d234195315d4020bd',
    name: 'Ключ от перехода на Приморском 46-48',
    kind: 'here',
    positions: [
      { x: 114.33, y: 1.42, z: 119.14 },
    ],
  },
  {
    mapId: 'streets-of-tarkov',
    itemId: '6582dbf0b8d7830efc45016f',
    name: 'Ключ от комнаты для расслаблений',
    kind: 'one-of',
    positions: [
      { x: 167.92, y: 1.6, z: 154.95 },
      { x: 164.97, y: 1.51, z: 144.62 },
      { x: 168.08, y: 1.78, z: 161.81 },
      { x: 152.12, y: 1.64, z: 135.64 },
      { x: 169.14, y: 2.26, z: 165.78 },
      { x: 154.59, y: 1.66, z: 137.62 },
      { x: 158.05, y: 1.48, z: 139.24 },
      { x: 164.26, y: 1.64, z: 168.14 },
      { x: 166.14, y: 2.12, z: 165.12 },
      { x: 168.27, y: 1.92, z: 164.37 },
      { x: 165.61, y: 1.62, z: 147.09 },
      { x: 163.71, y: 1.47, z: 157.81 },
    ],
  },
  {
    mapId: 'the-lab',
    itemId: '6711039f9e648049e50b3307',
    name: 'Ключ-карта от жилого модуля TerraGroup Labs',
    kind: 'one-of',
    positions: [
      { x: -118.62, y: 0.63, z: -436.58 },
      { x: -101.81, y: 0.73, z: -429.59 },
      { x: -84.54, y: 0.95, z: -429.44 },
      { x: -90.87, y: 1.28, z: -425.98 },
      { x: -99.38, y: 1.14, z: -429.73 },
      { x: -94.07, y: 0.96, z: -432.92 },
      { x: -82.88, y: 0.8, z: -443.64 },
      { x: -109.69, y: 0.94, z: -443.77 },
      { x: -114.58, y: 0.05, z: -437.58 },
      { x: -108.11, y: 0.93, z: -438.46 },
      { x: -118.96, y: 0.9, z: -426.17 },
    ],
  },
]

/**
 * The Labyrinth's route items (keys 01–04, the corpse room key, the valve handwheel, the gas cutter): one of each lies at one
 * of a few spots every raid (owner, 20.11.2026: «100% спавна… вытаскивай из СПТ»; docs/quests/spt-sync-2026-11-20.md). From
 * the offline SPT 4.1.6 database (labyrinth/looseLoot.json): always-spawn groups whose chances add up to one item per raid.
 * Every spot of tarkov.dev's maps file for these items is one of them (within a metre, PvP, PvE and Season). They are not
 * drawn on their own: the route items' points (src/data/mapMarkerAdapter.ts, adaptRouteItems) say «одна из N» and get the
 * group's spots tarkov.dev has not got.
 */
export const ROUTE_ITEM_GROUPS: readonly GuaranteedSpawn[] = [
  {
    mapId: 'the-labyrinth',
    itemId: '679baa2c61f588ae2b062a24',
    name: 'Ключ 01',
    kind: 'one-of',
    positions: [
      { x: -24.11, y: 1.39, z: 64.11 },
      { x: -45.19, y: 1.17, z: 60.36 },
      { x: -23.35, y: 1.31, z: 65.19 },
      { x: -33.49, y: 1.19, z: 70.51 },
      { x: -42.57, y: 0.5, z: 64.85 },
      { x: -34.39, y: 1.45, z: 59.98 },
    ],
  },
  {
    mapId: 'the-labyrinth',
    itemId: '679baa4f59b8961f370dd683',
    name: 'Ключ 02',
    kind: 'one-of',
    positions: [
      { x: -1.08, y: 1.37, z: -35.73 },
      { x: 3.51, y: 0.93, z: -36.33 },
      { x: 0.04, y: 0.52, z: -31.43 },
      { x: 7.25, y: 0.73, z: -31.91 },
    ],
  },
  {
    mapId: 'the-labyrinth',
    itemId: '679baa5a59b8961f370dd685',
    name: 'Ключ 03',
    kind: 'one-of',
    positions: [
      { x: -43.87, y: 0.69, z: -14.98 },
      { x: -50.45, y: 0.76, z: -13.38 },
      { x: -30.6, y: 1.18, z: -15.52 },
      { x: -30.65, y: 1.44, z: -15.07 },
    ],
  },
  {
    mapId: 'the-labyrinth',
    itemId: '679baa9091966fe40408f149',
    name: 'Ключ 04',
    kind: 'one-of',
    positions: [
      { x: 22.76, y: 0.06, z: 58.58 },
      { x: 18.36, y: 0.61, z: 61.93 },
      { x: 22.97, y: 0.59, z: 62.41 },
      { x: 19.08, y: 0.04, z: 60.37 },
      { x: 24.33, y: 0.18, z: 58.94 },
      { x: 22.41, y: 0.36, z: 58.35 },
    ],
  },
  {
    mapId: 'the-labyrinth',
    itemId: '679bab714e9ca6b3d80586b4',
    name: 'Ключ от помещения с телами',
    kind: 'one-of',
    positions: [
      { x: -2.49, y: 0.52, z: 3.98 },
      { x: -17.1, y: 0.51, z: 48.15 },
      { x: -6.39, y: 0.62, z: 14.58 },
      { x: 4.06, y: 0.86, z: 29.31 },
      { x: 0.54, y: 0.88, z: 54.32 },
      { x: 5.35, y: 0.59, z: 40.97 },
    ],
  },
  {
    mapId: 'the-labyrinth',
    itemId: '678fa929819ddc4c350c0317',
    name: 'Штурвал вентиля',
    kind: 'one-of',
    positions: [
      { x: -2.89, y: 3.91, z: -31 },
      { x: 9.22, y: 4.07, z: -32.39 },
      { x: 5.31, y: 4.49, z: -36.3 },
      { x: -11.61, y: 3.85, z: -32.51 },
      { x: 4.75, y: 5.38, z: -31.4 },
    ],
  },
  // The gas cutter: two groups of five, one cutter in each every raid.
  {
    mapId: 'the-labyrinth',
    itemId: '67ab3d4b83869afd170fdd3f',
    name: 'Газовый резак "Огонёк BBQ-S43"',
    kind: 'one-of',
    positions: [
      { x: -35.04, y: 0.61, z: -18.01 },
      { x: -27.84, y: 1.18, z: -15.21 },
      { x: -29.26, y: 0.45, z: -20.05 },
      { x: -36.87, y: 0.69, z: -16.72 },
      { x: -41.42, y: 0.49, z: -18.22 },
    ],
  },
  {
    mapId: 'the-labyrinth',
    itemId: '67ab3d4b83869afd170fdd3f',
    name: 'Газовый резак "Огонёк BBQ-S43"',
    kind: 'one-of',
    positions: [
      { x: 31.76, y: -0.39, z: 47.07 },
      { x: 38.04, y: -0.49, z: 48.32 },
      { x: 30.76, y: -0.58, z: 48.53 },
      { x: 33.86, y: -0.43, z: 55.94 },
      { x: 37.24, y: -0.54, z: 45.23 },
    ],
  },
]
