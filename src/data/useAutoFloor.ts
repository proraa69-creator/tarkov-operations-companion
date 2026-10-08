import { useEffect } from 'react'
import type { GameMap } from '../domain/types'
import { playerFloor } from './mapProjection'

/** Hint on the floor button of the player's floor (the Maps page and the in-game minimap). */
export const PLAYER_FLOOR_HINT = 'Вы на этом этаже — по последнему скриншоту'

/**
 * «Этаж по скриншоту»: the map shows the floor the player is on (playerFloor) when a new screenshot arrives and when
 * the map is opened. A floor picked by hand stays until the next screenshot (a new `at`): re-renders, catalog refreshes
 * and the same position sent again (the minimap gets it on every open) leave the effect's inputs unchanged, so it does
 * not run. A map without floor heights yet (the offline catalog) switches nothing; the floor follows once the live map
 * data arrives. Returns the player's floor, to mark its button.
 */
export function useAutoFloor(
  map: Pick<GameMap, 'id' | 'floors' | 'layers'> | undefined,
  position: { x: number; y: number; z: number; at: number } | null | undefined,
  setFloor: (floor: string) => void,
  enabled = true,
): string | undefined {
  const floor = map && position ? playerFloor(map, position) : undefined
  const mapId = map?.id
  const at = position?.at
  useEffect(() => {
    // `mapId` is an input too: opening the map again shows the player's floor again.
    if (enabled && floor && mapId && at != null) setFloor(floor)
  }, [mapId, at, floor, enabled, setFloor])
  return floor
}
