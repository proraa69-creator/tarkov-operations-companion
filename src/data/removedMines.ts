/**
 * Mines the game no longer has, though tarkov.dev's files still draw them (a player's report №79; owner, 06.11.2026: «на берегу убрали
 * мины. У нас на карте тоже убери все мины. Ну, вот эти красные отметки»). Map id → the groups of its scheme that draw them. They go
 * from the scheme and «Спутник» (components/FloorSvgOverlay.tsx) and from the layer «Опасности» (data/mapMarkerAdapter.ts); the
 * map's sniper zones and artillery stay.
 */
const REMOVED: Readonly<Record<string, readonly string[]>> = { shoreline: ['Mines'] }
const NONE: readonly string[] = []

export const removedMineGroups = (mapId: string) => REMOVED[mapId] ?? NONE
export const minesRemoved = (mapId: string) => mapId in REMOVED
