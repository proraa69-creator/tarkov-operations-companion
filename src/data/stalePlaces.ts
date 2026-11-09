/**
 * Places the data still gives an objective from an older version of its quest, by the game's objective id and map
 * (report of 10.11.2026, «Витамины»: the chemical container is on Factory now; the Shoreline spot in the Health Resort was the
 * old quest's). Neither a point on the map nor a map of the objective.
 */
const STALE_OBJECTIVE_MAPS: Readonly<Record<string, readonly string[]>> = {
  '5b478f6886f774464201225a': ['shoreline'],
}

export const isStalePlace = (objectiveId: string, mapId: string | undefined) =>
  Boolean(mapId && STALE_OBJECTIVE_MAPS[objectiveId]?.includes(mapId))
