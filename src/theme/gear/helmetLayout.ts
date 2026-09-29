/**
 * Saved settings of the 3D mask badge (see HelmetBadge): how the head is tilted and turned on top of its
 * resting three-quarter view, and where the player dragged the badge. Plain functions, kept apart from the
 * component so the storage migration and the on-screen clamping can be unit-tested.
 */

/** Head angles in degrees on top of the resting pose (0 everywhere = the resting pose), as the viewer sees them. */
export interface HelmetAngles {
  /** Nod: + looks up, − looks down. */
  pitch: number
  /** Tilt toward a shoulder: + leans to the right. */
  roll: number
  /** Turn: + turns to the right. */
  yaw: number
}

export interface HelmetLayout extends HelmetAngles {
  /** Offset in px from the badge's own spot at the right end of «Обзор» (press and hold the settings button, then drag). */
  dx: number
  dy: number
  /** Model scale and badge size in px, from layouts saved with the very first editor: no controls any more, still honoured. */
  scale: number
  size: number
}

export type AngleKey = keyof HelmetAngles

export const LAYOUT_KEY = 'gear-helmet-layout-v2'
/** Older layout: absolute three.js angles (rotX / rotY / rotZ, Euler 'YXZ', degrees) plus dx / dy / scale / size. */
export const LEGACY_LAYOUT_KEY = 'gear-helmet-layout-v1'

/** The resting pose in three.js Euler 'YXZ' degrees: nodding 12° down, turned 35° to the left, leaning 8° right. */
export const REST_POSE = { rotX: 12, rotY: -35, rotZ: -8 } as const

/** Slider range of each angle, ± degrees from the resting pose. */
export const ANGLE_LIMITS: Record<AngleKey, number> = { pitch: 45, roll: 45, yaw: 90 }

export const DEFAULT_LAYOUT: HelmetLayout = { pitch: 0, roll: 0, yaw: 0, dx: 0, dy: 0, scale: 1, size: 86 }

const MAX_OFFSET = 5000
const EDGE = 4

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const numberOr = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
/** −180..180 */
const wrapDegrees = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180

export function clampAngle(key: AngleKey, degrees: number) {
  return clamp(Math.round(degrees), -ANGLE_LIMITS[key], ANGLE_LIMITS[key])
}

/** Whatever was stored under the current key, made safe: unknown fields dropped, numbers clamped, junk replaced by defaults. */
export function sanitizeLayout(saved: Record<string, unknown>): HelmetLayout {
  const read = (key: keyof HelmetLayout) => numberOr(saved[key], DEFAULT_LAYOUT[key])
  return {
    pitch: clampAngle('pitch', read('pitch')),
    roll: clampAngle('roll', read('roll')),
    yaw: clampAngle('yaw', read('yaw')),
    dx: clamp(Math.round(read('dx')), -MAX_OFFSET, MAX_OFFSET),
    dy: clamp(Math.round(read('dy')), -MAX_OFFSET, MAX_OFFSET),
    scale: clamp(read('scale'), 0.4, 2.5),
    size: clamp(Math.round(read('size')), 56, 220),
  }
}

/**
 * The older absolute angles as offsets from the resting pose, so the mask keeps looking the way it did: the old
 * «Наклон» slider (rotZ) becomes the left / right tilt, the first editor's rotX / rotY the nod and the turn.
 * The position (dx / dy), scale and size carry over unchanged.
 */
export function migrateLegacyLayout(saved: Record<string, unknown>): HelmetLayout {
  return sanitizeLayout({
    pitch: REST_POSE.rotX - numberOr(saved.rotX, REST_POSE.rotX),
    roll: REST_POSE.rotZ - numberOr(saved.rotZ, REST_POSE.rotZ),
    yaw: wrapDegrees(numberOr(saved.rotY, REST_POSE.rotY) - REST_POSE.rotY),
    dx: saved.dx, dy: saved.dy, scale: saved.scale, size: saved.size,
  })
}

type ReadableStorage = Pick<Storage, 'getItem'>

function browserStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function readObject(storage: ReadableStorage | null, key: string): Record<string, unknown> | null {
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? 'null') as unknown
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** The saved layout; an older one is converted on the fly (the old key is left as it was). */
export function loadLayout(storage: ReadableStorage | null = browserStorage()): HelmetLayout {
  const saved = readObject(storage, LAYOUT_KEY)
  if (saved) return sanitizeLayout(saved)
  const legacy = readObject(storage, LEGACY_LAYOUT_KEY)
  return legacy ? migrateLegacyLayout(legacy) : { ...DEFAULT_LAYOUT }
}

export function saveLayout(layout: HelmetLayout, storage: Pick<Storage, 'setItem'> | null = browserStorage()) {
  try { storage?.setItem(LAYOUT_KEY, JSON.stringify(layout)) } catch { /* storage unavailable */ }
}

/** The right end and vertical middle of the «Обзор» item, plus the window size it was measured in. */
export interface BadgeSpot { top: number; left: number; width: number; height: number }

/** Where the mask's box and its settings button are drawn: the button sits on the box's top-right corner. */
export function badgeBoxes(spot: BadgeSpot, dx: number, dy: number, size: number) {
  const right = spot.left + dx
  const top = spot.top + dy - size / 2 - 3
  return { helmet: { left: right - size - 6, top }, button: { left: right - 10, top } }
}

/** The offset nearest to (dx, dy) that keeps the whole badge (mask and button) inside the window. */
export function clampOffset(spot: BadgeSpot, dx: number, dy: number, size: number) {
  const minDx = EDGE + size + 6 - spot.left, maxDx = spot.width - EDGE - 10 - spot.left
  const minDy = EDGE + size / 2 + 3 - spot.top, maxDy = spot.height - EDGE - size / 2 + 3 - spot.top
  return { dx: Math.max(minDx, Math.min(maxDx, dx)), dy: Math.max(minDy, Math.min(maxDy, dy)) }
}
