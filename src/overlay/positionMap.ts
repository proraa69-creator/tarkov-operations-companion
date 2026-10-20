/**
 * Which map the player's dot belongs to. The game's screenshot gives the coordinates only; the map comes from the game's
 * logs (the raid's location). When the logs do not name it — not found yet, a Steam copy logging elsewhere, an offline or
 * training raid, the first seconds after the spawn, a log line the app does not know — the dot goes on the map that is
 * open, as the minimap over the game did before 15.10.2026 («use the map selected in the app»), as long as the screenshot
 * is fresh and its coordinates lie on that map. Removing that minimap left «Карты» with the logs' map only, so with no
 * map in the logs no dot ever appeared.
 */

/** A screenshot older than this is not the player's position any more (the main process sends none older either). */
export const POSITION_FRESH_MS = 20 * 60 * 1000
/** Coordinates this far (a share of the map's size) outside its bounds still count as on the map. */
const BOUNDS_MARGIN = 0.15

export type PlayerMapReason =
  /** On the raid's map from the logs. */
  | 'raid-map'
  /** The logs name no map: on the open map (its coordinates fit it). */
  | 'shown-map'
  /** The logs name another map. */
  | 'other-raid-map'
  /** Taken before the raid in the logs started. */
  | 'before-raid'
  /** Taken before the logs said the raid ended (this window saw it end). */
  | 'after-raid'
  /** Older than POSITION_FRESH_MS. */
  | 'stale'
  /** The logs are followed and say no raid is on (owner, 18.10.2026: the dot only during a raid). */
  | 'not-in-raid'
  /** The logs name no map and the coordinates are off the open map. */
  | 'off-map'
  /**
   * The logs are followed and say a raid is on but name no map yet: no dot rather than one on whatever map is open
   * (owner, 20.10.2026: «точка показывается на всех картах. Нужно, чтобы она показывалась только на карте, на которой я
   * сейчас в игре»).
   */
  | 'unknown-raid-map'
  | 'no-position'

export interface PlayerMapInput {
  /** The map open on the page. */
  mapId: string
  position: { x: number; z: number; at: number } | null | undefined
  /** The raid's map from the game's logs ('' when unknown). */
  raidMapId: string
  /** When the raid in the logs started. */
  raidSince?: number
  /** When this window saw the logs say the raid ended (0 / undefined: not seen). */
  raidEndedAt?: number
  /** The logs are followed and say no raid is on: no dot at all (a screenshot from the menu or the hideout). */
  outOfRaid?: boolean
  /** The logs are followed and say a raid is on, without its map: no dot (never a guess on the open map). */
  inRaidMapUnknown?: boolean
  /** The open map's game-space bounds ([[x, z], [x, z]]; absent: any coordinates fit). */
  bounds?: [[number, number], [number, number]]
  now?: number
}

export interface PlayerPlacement {
  onThisMap: boolean
  /** The map is the open one, not one the logs named. */
  guessed: boolean
  reason: PlayerMapReason
}

export function placePlayer(input: PlayerMapInput): PlayerPlacement {
  const { position, mapId, raidMapId } = input
  const no = (reason: PlayerMapReason): PlayerPlacement => ({ onThisMap: false, guessed: false, reason })
  if (!position) return no('no-position')
  if (input.outOfRaid) return no('not-in-raid')
  if (raidMapId) {
    if (raidMapId !== mapId) return no('other-raid-map')
    if (input.raidSince && position.at < input.raidSince) return no('before-raid')
    return { onThisMap: true, guessed: false, reason: 'raid-map' }
  }
  if (input.inRaidMapUnknown) return no('unknown-raid-map')
  if ((input.now ?? Date.now()) - position.at >= POSITION_FRESH_MS) return no('stale')
  if (input.raidEndedAt && position.at <= input.raidEndedAt) return no('after-raid')
  if (input.bounds && !withinBounds(position, input.bounds)) return no('off-map')
  return { onThisMap: true, guessed: true, reason: 'shown-map' }
}

/** The coordinates lie on the map (game x / z against its bounds, with a margin). */
export function withinBounds(position: { x: number; z: number }, bounds: [[number, number], [number, number]]) {
  const [[x1, z1], [x2, z2]] = bounds
  if (![x1, z1, x2, z2].every(Number.isFinite)) return true
  const marginX = Math.abs(x2 - x1) * BOUNDS_MARGIN
  const marginZ = Math.abs(z2 - z1) * BOUNDS_MARGIN
  return position.x >= Math.min(x1, x2) - marginX && position.x <= Math.max(x1, x2) + marginX
    && position.z >= Math.min(z1, z2) - marginZ && position.z <= Math.max(z1, z2) + marginZ
}
