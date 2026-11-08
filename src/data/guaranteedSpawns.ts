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
}

export const GUARANTEED_SPAWNS: readonly GuaranteedSpawn[] = [
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
