/**
 * The body parts of a pictured character as the picture shows them (owner, 22.11.2026: «сделай обводку попадания… когда пуля
 * попадает по конечности, там у нас просто овал. Сделай, чтобы обводилась прям конечность, ну, одежда в точности прям по
 * контурам»): every drawn pixel of the character and its armour belongs to the body part whose hit collider it lies in, or else to
 * the nearest one through the drawn pixels; each part gives a filled mask and an outline, as pictures laid over the figure.
 */
import type { FigurePicture, FigureZone } from './rangeFigures'
import { BODY_PARTS, type BodyPart } from './rangeModel'

/** Pixels per figure centimetre of the masks. */
const PX = 3

export interface PartMasks {
  /** The masks' place on the figure, centimetres (left edge, top edge up from the soles, size). */
  x: number
  top: number
  width: number
  height: number
  /** A part's drawn area, filled white (tinted when drawn). */
  fill: Partial<Record<BodyPart, string>>
  /** A part's outline, two pixels wide. */
  edge: Partial<Record<BodyPart, string>>
}

/** Labels: 0 nothing, i + 1 the i-th body part. */
export function labelPixels(opaque: Uint8Array, seeds: Uint8Array, width: number, height: number): Uint8Array {
  const label = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0, tail = 0
  for (let i = 0; i < label.length; i++) {
    if (opaque[i] && seeds[i]) { label[i] = seeds[i]!; queue[tail++] = i }
  }
  // the drawn pixels outside every collider take the part reached first through drawn pixels
  while (head < tail) {
    const i = queue[head++]!
    const x = i % width
    const next = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]
    for (const j of next) {
      if (j < 0 || j >= label.length || label[j] || !opaque[j]) continue
      label[j] = label[i]!
      queue[tail++] = j
    }
  }
  return label
}

/** The edge pixels of one label: in it, with a neighbour out of it (then grown by one pixel inwards). */
export function edgePixels(label: Uint8Array, value: number, width: number, height: number): Uint8Array {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && label[y * width + x] === value
  const edge = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) edge[y * width + x] = 1
    }
  }
  const grown = edge.slice()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!edge[y * width + x]) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (inside(x + dx, y + dy)) grown[(y + dy) * width + x + dx] = 1
    }
  }
  return grown
}

async function loadImage(url: string) {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}

function toUrl(mask: Uint8Array, width: number, height: number, rgb: [number, number, number]) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  const data = context.createImageData(width, height)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    data.data[i * 4] = rgb[0]; data.data[i * 4 + 1] = rgb[1]; data.data[i * 4 + 2] = rgb[2]; data.data[i * 4 + 3] = 255
  }
  context.putImageData(data, 0, 0)
  return canvas.toDataURL('image/png')
}

/** The masks of a figure drawn from these pictures (the character, then its armour) and the base picture's hit zones. */
export async function buildPartMasks(pictures: FigurePicture[], urls: Record<string, string>, zones: FigureZone[]): Promise<PartMasks | undefined> {
  const drawn = pictures.filter((picture) => urls[picture.file])
  if (!drawn.length || typeof document === 'undefined') return undefined
  const left = Math.min(...drawn.map((picture) => picture.x))
  const right = Math.max(...drawn.map((picture) => picture.x + picture.width))
  const top = Math.max(...drawn.map((picture) => picture.top))
  const bottom = Math.min(...drawn.map((picture) => picture.top - picture.height))
  const width = Math.ceil((right - left) * PX), height = Math.ceil((top - bottom) * PX)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  for (const picture of drawn) {
    const image = await loadImage(urls[picture.file]!)
    context.drawImage(image, (picture.x - left) * PX, (top - picture.top) * PX, picture.width * PX, picture.height * PX)
  }
  const pixels = context.getImageData(0, 0, width, height).data
  const opaque = new Uint8Array(width * height)
  for (let i = 0; i < opaque.length; i++) opaque[i] = pixels[i * 4 + 3]! > 110 ? 1 : 0
  // the colliders, the farthest first, each filled with its part's number in red
  context.clearRect(0, 0, width, height)
  for (const zone of [...zones].filter((entry) => !entry.plate).sort((a, b) => b.depth - a.depth)) {
    const value = BODY_PARTS.indexOf(zone.part) + 1
    if (!value || zone.poly.length < 3) continue
    context.fillStyle = `rgb(${value}, 0, 0)`
    context.beginPath()
    zone.poly.forEach(([x, y], index) => {
      const px = (x - left) * PX, py = (top - y) * PX
      if (index) context.lineTo(px, py)
      else context.moveTo(px, py)
    })
    context.closePath()
    context.fill()
  }
  const painted = context.getImageData(0, 0, width, height).data
  const seeds = new Uint8Array(width * height)
  for (let i = 0; i < seeds.length; i++) {
    const r = painted[i * 4]!, g = painted[i * 4 + 1]!, b = painted[i * 4 + 2]!, a = painted[i * 4 + 3]!
    if (a === 255 && g === 0 && b === 0 && r >= 1 && r <= BODY_PARTS.length) seeds[i] = r
  }
  const label = labelPixels(opaque, seeds, width, height)
  const fill: PartMasks['fill'] = {}
  const edge: PartMasks['edge'] = {}
  BODY_PARTS.forEach((part, index) => {
    const value = index + 1
    const mask = label.map((entry) => (entry === value ? 1 : 0))
    if (!mask.some(Boolean)) return
    fill[part] = toUrl(mask, width, height, [226, 87, 76])
    edge[part] = toUrl(edgePixels(label, value, width, height), width, height, [255, 214, 92])
  })
  return { x: left, top, width: right - left, height: top - bottom, fill, edge }
}
