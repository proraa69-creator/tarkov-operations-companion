// The owner's own top-down render of Customs (SPT capture, raidos-map-capture/exports/customs-interactive-full; the owner
// allowed it for the English trailer, 27.10.2026) cut into the tiles the app asks for on «Карты» and the phone's live map.
// The export is a Leaflet pyramid in game metres: px = 2^k (x - origin.x), py = 2^k (origin.z - z), 256 px tiles.
// The app draws Customs with tarkov.dev's maps.json transform [0.239, 168.65, 0.239, 136.35] and coordinateRotation 180
// (src/components/mapCrs.ts): px = 2^Z (168.65 - 0.239 x), py = 2^Z (136.35 + 0.239 z). So an app tile is a rectangle of
// the export turned by 180°.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const sharp = createRequire(import.meta.url)('sharp')
export const OWN_MAP_DIR = process.env.TRAILER_OWN_MAP ?? 'C:/Users/BANGKOK PC/raidos-map-capture/exports/customs-interactive-full'
const ORIGIN = { x: -376, z: 264 }
const T = [0.239, 168.65, 0.239, 136.35]
const MAX_K = 5
const BLANK = { r: 11, g: 18, b: 14 }

const done = new Map()
let full3 = null
/** The whole surface at export zoom 3 (8 px a metre) as one raw picture, for the far-out tiles. */
export async function fullAt3() {
  if (full3) return full3
  const dir = join(OWN_MAP_DIR, 'tiles', 'surface', '3')
  const parts = []
  let w = 0, h = 0
  for (const ix of readdirSync(dir)) for (const f of readdirSync(join(dir, ix))) {
    const iy = parseInt(f, 10)
    parts.push({ input: join(dir, ix, f), left: Number(ix) * 256, top: iy * 256 })
    w = Math.max(w, (Number(ix) + 1) * 256); h = Math.max(h, (iy + 1) * 256)
  }
  full3 = await sharp({ create: { width: w, height: h, channels: 3, background: BLANK }, limitInputPixels: false }).composite(parts).raw().toBuffer({ resolveWithObject: true })
  return full3
}

/** PNG of the app's Customs tile z/x/y (256 px) cut from the owner's render. */
export async function ownCustomsTile(Z, tx, ty) {
  const key = `${Z}/${tx}/${ty}`
  if (!done.has(key)) done.set(key, cutTile(Z, tx, ty).catch(() => sharp({ create: { width: 256, height: 256, channels: 3, background: BLANK } }).png().toBuffer()))
  return done.get(key)
}
async function cutTile(Z, tx, ty) {
  const s = 2 ** Z
  const gx = (px) => (T[1] - px / s) / T[0]
  const gz = (py) => (py / s - T[3]) / T[0]
  const xmax = gx(256 * tx), xmin = gx(256 * (tx + 1))
  const zmin = gz(256 * ty), zmax = gz(256 * (ty + 1))
  const metres = xmax - xmin
  // the export's low zoom levels have gaps, so far-out tiles are cut from zoom 3 at least
  let k = 3
  while (k < MAX_K && 2 ** k * metres < 256) k++
  const e = 2 ** k
  const left = e * (xmin - ORIGIN.x), right = e * (xmax - ORIGIN.x)
  const top = e * (ORIGIN.z - zmax), bottom = e * (ORIGIN.z - zmin)
  const L = Math.floor(left), Tp = Math.floor(top)
  const W = Math.max(1, Math.ceil(right) - L), H = Math.max(1, Math.ceil(bottom) - Tp)
  if (k === 3 && W > 512) {
    const f = await fullAt3()
    const out = await sharp({ create: { width: W, height: H, channels: 3, background: BLANK } })
      .composite([{ input: await sharp(f.data, { raw: f.info, limitInputPixels: false }).extract({ left: Math.max(0, L), top: Math.max(0, Tp), width: Math.max(1, Math.min(f.info.width, L + W) - Math.max(0, L)), height: Math.max(1, Math.min(f.info.height, Tp + H) - Math.max(0, Tp)) }).png().toBuffer(), left: Math.max(0, -L), top: Math.max(0, -Tp) }])
      .raw().toBuffer({ resolveWithObject: true })
    return sharp(out.data, { raw: out.info }).rotate(180).resize(256, 256, { fit: 'fill' }).png().toBuffer()
  }
  const parts = []
  for (let ix = Math.floor(L / 256); ix <= Math.floor((L + W - 1) / 256); ix++) {
    for (let iy = Math.floor(Tp / 256); iy <= Math.floor((Tp + H - 1) / 256); iy++) {
      const file = join(OWN_MAP_DIR, 'tiles', 'surface', String(k), String(ix), `${iy}.jpg`)
      if (ix >= 0 && iy >= 0 && existsSync(file)) parts.push({ input: file, left: ix * 256 - L, top: iy * 256 - Tp })
    }
  }
  if (!parts.length) return sharp({ create: { width: 256, height: 256, channels: 3, background: BLANK } }).png().toBuffer()
  // the composite canvas spans whole export tiles, then the exact rectangle is cut out of it
  const minL = Math.min(0, ...parts.map((p) => p.left)), minT = Math.min(0, ...parts.map((p) => p.top))
  const cw = Math.max(W, ...parts.map((p) => p.left + 256)) - minL, ch = Math.max(H, ...parts.map((p) => p.top + 256)) - minT
  const canvas = await sharp({ create: { width: cw, height: ch, channels: 3, background: BLANK } })
    .composite(parts.map((p) => ({ ...p, left: p.left - minL, top: p.top - minT }))).raw().toBuffer({ resolveWithObject: true })
  return sharp(canvas.data, { raw: canvas.info }).extract({ left: -minL, top: -minT, width: W, height: H })
    .rotate(180).resize(256, 256, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer()
}

/** z/x/y of an app Customs tile URL (the main level of tarkov.dev's customs_0.16 set, direct or through raidos.app's mirror). */
export function customsTileOf(url) {
  const m = /customs_0\.16\/[^/]+\/(\d+)\/(-?\d+)\/(-?\d+)\.(?:png|jpg|webp)/.exec(url)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
