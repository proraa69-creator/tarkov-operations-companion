export interface PlayerPosition {
  x: number
  y: number
  z: number
  /** Camera heading in degrees around the vertical axis (0 = +z, 90 = +x). */
  yaw: number
  at: number
}

const NUMBER = String.raw`([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)`
/** EFT writes the camera position and rotation into the screenshot file name:
 * `2024-06-13[11-05]_-181.42, 3.27, -77.07_0.02063, -0.84017, 0.03179, 0.54108_11.02 (0).png` */
const SCREENSHOT_NAME = new RegExp(`_${NUMBER},\\s*${NUMBER},\\s*${NUMBER}_${NUMBER},\\s*${NUMBER},\\s*${NUMBER},\\s*${NUMBER}_`)

export function isPositionScreenshot(name: string) {
  return /\.(png|jpe?g|bmp)$/i.test(name) && SCREENSHOT_NAME.test(name)
}

export function parseScreenshotPosition(name: string, at = Date.now()): PlayerPosition | null {
  const match = SCREENSHOT_NAME.exec(name)
  if (!match) return null
  const [x, y, z, qx, qy, qz, qw] = match.slice(1).map(Number) as [number, number, number, number, number, number, number]
  if (![x, y, z, qx, qy, qz, qw].every(Number.isFinite)) return null
  // Unity is Y-up: rotate the forward axis (0, 0, 1) by the quaternion and read its heading.
  const forwardX = 2 * (qx * qz + qw * qy)
  const forwardZ = 1 - 2 * (qx * qx + qy * qy)
  const yaw = (Math.atan2(forwardX, forwardZ) * 180) / Math.PI
  return { x, y, z, yaw, at }
}
