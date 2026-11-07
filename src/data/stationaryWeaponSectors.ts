/**
 * Report №89: where each stationary weapon points and how far it turns to each side (owner, 07.11.2026: «вот он стоит, на север,
 * значит, он должен на север… поворачиваться… дальше он не может назад смотреть»), by its place on the map in game metres.
 * `heading`: degrees from the map's +z towards +x; `left` / `right`: how far it turns from there. Whole degrees.
 */
export interface WeaponSector { x: number; z: number; heading: number; left: number; right: number }

export const STATIONARY_WEAPON_SECTORS: Readonly<Record<string, readonly WeaponSector[]>> = {
  'customs': [
    { x: 188.57, z: -111.26, heading: 262, left: 36, right: 34 },
    { x: 67.7, z: -12.77, heading: 273, left: 39, right: 42 },
    { x: 193.25, z: -132.86, heading: 262, left: 42, right: 41 },
    { x: 192.51, z: -100.2, heading: 348, left: 18, right: 19 },
  ],
  'ground-zero': [
    { x: 57.23, z: 128.32, heading: 182, left: 41, right: 41 },
    { x: 98.56, z: 277.28, heading: 195, left: 19, right: 18 },
  ],
  'interchange': [
    { x: -205.5, z: -345.19, heading: 358, left: 42, right: 39 },
    { x: -194.26, z: -347.22, heading: 86, left: 39, right: 41 },
  ],
  'reserve': [
    { x: -116.64, z: -31.2, heading: 137, left: 36, right: 34 },
    { x: 150.76, z: -126.63, heading: 283, left: 39, right: 42 },
    { x: -0.26, z: 138.76, heading: 154, left: 42, right: 41 },
    { x: -4.2, z: -202.78, heading: 333, left: 38, right: 39 },
    { x: -125.28, z: -8.81, heading: 353, left: 41, right: 41 },
    { x: -25.0, z: 168.0, heading: 197, left: 19, right: 18 },
    { x: -259.31, z: -77.19, heading: 59, left: 22, right: 19 },
    { x: 227.49, z: -8.47, heading: 240, left: 19, right: 21 },
  ],
  'shoreline': [
    { x: -979.99, z: 377.3, heading: 133, left: 21, right: 19 },
    { x: -954.46, z: 386.93, heading: 176, left: 19, right: 22 },
    { x: -873.76, z: 473.54, heading: 162, left: 22, right: 21 },
    { x: -672.08, z: -169.5, heading: 20, left: 18, right: 19 },
  ],
  'streets-of-tarkov': [
    { x: 58.05, z: 271.15, heading: 219, left: 41, right: 41 },
    { x: 73.62, z: 285.57, heading: 174, left: 39, right: 38 },
    { x: 200.3, z: 307.88, heading: 0, left: 42, right: 39 },
    { x: 85.72, z: 323.17, heading: 342, left: 39, right: 41 },
    { x: 47.36, z: 142.52, heading: 267, left: 41, right: 39 },
    { x: 72.01, z: 303.83, heading: 167, left: 19, right: 22 },
    { x: 64.72, z: 266.18, heading: 236, left: 22, right: 21 },
    { x: 80.82, z: 324.12, heading: 31, left: 18, right: 19 },
    { x: -157.62, z: -1.44, heading: 14, left: 41, right: 41 },
  ],
  'woods': [
    { x: -184.84, z: 198.52, heading: 184, left: 39, right: 38 },
    { x: 402.88, z: 231.12, heading: 198, left: 42, right: 39 },
  ],
}

/** The sector of the weapon standing at `position` ([z, x], as the map's markers keep it), if it is known. */
export function weaponSectorAt(mapId: string, position: readonly [number, number]): WeaponSector | undefined {
  return STATIONARY_WEAPON_SECTORS[mapId]?.find((sector) => Math.abs(sector.z - position[0]) < 2 && Math.abs(sector.x - position[1]) < 2)
}
