/**
 * How a boss stands in a picture: scaled to its body height (feet to the top of the head, not counting a raised rifle,
 * antlers or horns) and seen by one camera. Shared by the Gallery's live viewer (its start view) and the stills
 * (scripts/bosses/figure.ts), so the still the viewer shows while a model loads is exactly where the model then appears
 * and turning to the next boss does not make the figure jump (owner, 11.10.2026: «при переключении не прыгали персонажи»).
 */

/** Visible height of the frame at the figure, in body heights (room for what sticks up above the head). */
export const FRAME = 1.34
/** Vertical field of view, degrees. */
export const FOV = 22
/** The view a figure is first seen from: turned this far about its vertical axis, degrees. */
export const START_YAW_DEG = -18
/** Where the camera looks: this far above the feet, body heights. */
export const LOOK_AT_Y = (0.5 * FRAME) / 1.2
/** Where the camera stands (x = 0): body heights. */
export const CAMERA = { y: (0.62 * FRAME) / 1.2, z: (3.1 * FRAME) / 1.2 }
/** The same camera as the viewer's orbit holds it: tilt (radians) and distance from LOOK_AT_Y. */
export const START_PITCH = Math.atan2(CAMERA.y - LOOK_AT_Y, CAMERA.z)
export const START_DISTANCE = Math.hypot(CAMERA.y - LOOK_AT_Y, CAMERA.z)

/**
 * Height of the top of the head above the feet (model units): the highest slice of the column over the torso that is
 * still head-wide — antennas, antlers, horn tips and raised barrels are narrow or off to the side. `points`: x, y, z of
 * every vertex of the standing model.
 */
export function headTop(points: ArrayLike<number>, minY: number, height: number): number {
  const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1] ?? 0
  // centred on the neck and lower head, which a shield, a sword or a rifle held at the hip cannot pull aside
  const neckX: number[] = [], neckZ: number[] = []
  for (let i = 0; i + 2 < points.length; i += 3) {
    const y = points[i + 1]
    if (y > minY + 0.8 * height && y < minY + 0.9 * height) { neckX.push(points[i]); neckZ.push(points[i + 2]) }
  }
  const cx = median(neckX), cz = median(neckZ)
  const column: number[] = []
  for (let i = 0; i + 2 < points.length; i += 3) {
    if (points[i + 1] > minY + 0.6 * height && Math.hypot(points[i] - cx, points[i + 2] - cz) < 0.09 * height) column.push(i)
  }
  const slice = 0.01 * height
  for (let top = minY + height; top > minY + 0.6 * height; top -= slice) {
    let count = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const i of column) {
      const y = points[i + 1]
      if (y > top || y <= top - slice) continue
      count++
      x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i]); z0 = Math.min(z0, points[i + 2]); z1 = Math.max(z1, points[i + 2])
    }
    if (count >= 6 && x1 - x0 > 0.06 * height && z1 - z0 > 0.06 * height) return top - minY
  }
  return height
}
