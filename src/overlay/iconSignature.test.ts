import { describe, expect, it } from 'vitest'
import { iconArea, pictureSignature, pictureSignatures, signatureDistance, type Area, type PictureSignature, type Pixels } from './iconSignature'

type Shape = { kind: 'rect' | 'disc'; x: number; y: number; w: number; h: number; color: [number, number, number] }
interface Picture { background: [number, number, number]; shapes: Shape[] }

/** Draws a picture (shapes in 0…1 coordinates) at any size, 4×4 supersampled: the same picture as icon and on screen. */
function paint(picture: Picture, width: number, height: number, order: 'rgba' | 'bgra' = 'rgba', turned = false): Pixels {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sum = [0, 0, 0]
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          let u = (x + (sx + 0.5) / 4) / width, v = (y + (sy + 0.5) / 4) / height
          // A picture turned a quarter clockwise: screen (u, v) shows picture (v, 1 - u).
          if (turned) [u, v] = [v, 1 - u]
          let color = picture.background
          for (const shape of picture.shapes) {
            const inside = shape.kind === 'rect'
              ? u >= shape.x && u < shape.x + shape.w && v >= shape.y && v < shape.y + shape.h
              : ((u - shape.x) / shape.w) ** 2 + ((v - shape.y) / shape.h) ** 2 <= 1
            if (inside) color = shape.color
          }
          sum[0] += color[0]; sum[1] += color[1]; sum[2] += color[2]
        }
      }
      const index = (y * width + x) * 4
      const [r, g, b] = sum.map((value) => Math.round(value / 16))
      data[index] = order === 'rgba' ? r! : b!
      data[index + 1] = g!
      data[index + 2] = order === 'rgba' ? b! : r!
      data[index + 3] = 255
    }
  }
  return { width, height, data, order }
}

const CAN: Picture = { background: [40, 44, 46], shapes: [{ kind: 'rect', x: 0.3, y: 0.15, w: 0.4, h: 0.7, color: [170, 160, 60] }, { kind: 'rect', x: 0.3, y: 0.15, w: 0.4, h: 0.12, color: [210, 210, 205] }] }
const GRENADE: Picture = { background: [40, 44, 46], shapes: [{ kind: 'disc', x: 0.5, y: 0.6, w: 0.3, h: 0.3, color: [70, 90, 60] }, { kind: 'rect', x: 0.45, y: 0.15, w: 0.12, h: 0.2, color: [120, 120, 110] }] }
const RIFLE_PART: Picture = { background: [30, 30, 30], shapes: [{ kind: 'rect', x: 0.05, y: 0.4, w: 0.9, h: 0.2, color: [90, 90, 90] }, { kind: 'rect', x: 0.6, y: 0.55, w: 0.1, h: 0.35, color: [60, 50, 40] }] }
const whole = (pixels: Pixels) => ({ x: 0, y: 0, width: pixels.width, height: pixels.height })

describe('picture signature', () => {
  it('is about the same for the 64 px icon and the picture the game draws at any resolution', () => {
    const icon = pictureSignature(paint(CAN, 64, 64), whole(paint(CAN, 64, 64)))
    for (const size of [47, 63, 84, 126]) {
      const screen = paint(CAN, size, size, 'bgra')
      const distance = signatureDistance(pictureSignature(screen, whole(screen)), icon)
      expect(distance.distance).toBeLessThan(0.06)
      expect(distance.known).toBe(1)
    }
  })

  it('tells different pictures apart', () => {
    const icon = paint(GRENADE, 64, 64)
    const screen = paint(CAN, 63, 63, 'bgra')
    expect(signatureDistance(pictureSignature(screen, whole(screen)), pictureSignature(icon, whole(icon))).distance).toBeGreaterThan(0.25)
  })

  it('leaves covered parts out on the screen side and in the comparison', () => {
    const icon = paint(CAN, 64, 64)
    const screen = paint(CAN, 84, 84, 'bgra')
    // The tooltip over the lower half, drawn as a bright block.
    for (let y = 50; y < 84; y += 1) for (let x = 0; x < 84; x += 1) screen.data.set([230, 230, 230, 255], (y * 84 + x) * 4)
    const covered = [{ x: 0, y: 50, width: 84, height: 34 }]
    const masked = signatureDistance(pictureSignature(screen, whole(screen), covered), pictureSignature(icon, whole(icon)))
    const unmasked = signatureDistance(pictureSignature(screen, whole(screen)), pictureSignature(icon, whole(icon)))
    expect(masked.distance).toBeLessThan(0.06)
    expect(masked.known).toBeLessThan(0.7)
    expect(unmasked.distance).toBeGreaterThan(masked.distance + 0.1)
  })

  it('turns a rotated item back to the icon orientation', () => {
    const icon = paint(RIFLE_PART, 128, 64)
    const iconSignature = pictureSignature(icon, whole(icon))
    // Lying rotated in the inventory: one cell wide, two tall.
    const screen = paint(RIFLE_PART, 63, 126, 'bgra', true)
    const turnedBack = signatureDistance(pictureSignature(screen, whole(screen), [], 3), iconSignature)
    const asIs = signatureDistance(pictureSignature(screen, whole(screen), [], 0), iconSignature)
    expect(turnedBack.distance).toBeLessThan(0.08)
    expect(asIs.distance).toBeGreaterThan(turnedBack.distance + 0.1)
  })

  it('reads a flat picture as flat (no noise from equal neighbours)', () => {
    const flat = paint({ background: [60, 60, 60], shapes: [] }, 40, 40)
    expect(pictureSignature(flat, whole(flat)).steps).toBe('0'.repeat(128))
  })

  it('composes transparent icon pixels over the dark cell and reads both byte orders alike', () => {
    const rgba = paint(CAN, 64, 64)
    const bgra = paint(CAN, 64, 64, 'bgra')
    expect(pictureSignature(bgra, whole(bgra))).toEqual(pictureSignature(rgba, whole(rgba)))
    const clear: Pixels = { ...rgba, data: rgba.data.map((value, index) => (index % 4 === 3 ? 0 : value)), alpha: true }
    expect(pictureSignature(clear, whole(clear)).colors.slice(0, 3)).toEqual([28, 28, 28])
  })

  it('finds a non-square item picture fitted in its square icon', () => {
    const wide = iconArea(64, 64, 2, 1)
    expect(wide.width).toBeCloseTo(60, 0)
    expect(wide.height).toBeCloseTo(30, 0)
    expect(wide.y).toBeCloseTo(17, 0)
    const tall = iconArea(64, 64, 1, 3)
    expect(tall.height).toBeGreaterThan(tall.width * 2.9)
    expect(iconArea(64, 64, 1, 1)).toEqual({ x: 2, y: 2, width: 60, height: 60 })
  })
})

/** The signature as it was made before 18.11.2026: one pass over the pixels per thumbnail and turn (the reference). */
function referenceSignature(image: Pixels, area: Area, covered: Area[], turns: number): PictureSignature {
  const thumbnail = (width: number, height: number) => {
    const odd = turns % 2 !== 0
    const sourceWidth = odd ? height : width, sourceHeight = odd ? width : height
    const sums = new Float64Array(sourceWidth * sourceHeight * 3), seen = new Float64Array(sourceWidth * sourceHeight), all = new Float64Array(sourceWidth * sourceHeight)
    const [r, b] = image.order === 'rgba' ? [0, 2] : [2, 0]
    const x0 = Math.max(0, Math.round(area.x)), y0 = Math.max(0, Math.round(area.y))
    const x1 = Math.min(image.width, Math.round(area.x + area.width)), y1 = Math.min(image.height, Math.round(area.y + area.height))
    for (let y = y0; y < y1; y += 1) {
      const row = Math.min(sourceHeight - 1, Math.floor((y - y0) * sourceHeight / (y1 - y0)))
      for (let x = x0; x < x1; x += 1) {
        const cell = row * sourceWidth + Math.min(sourceWidth - 1, Math.floor((x - x0) * sourceWidth / (x1 - x0)))
        all[cell]! += 1
        if (covered.some((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)) continue
        const index = (y * image.width + x) * 4
        const opacity = image.alpha ? image.data[index + 3]! / 255 : 1
        sums[cell * 3]! += image.data[index + r]! * opacity + 28 * (1 - opacity)
        sums[cell * 3 + 1]! += image.data[index + 1]! * opacity + 28 * (1 - opacity)
        sums[cell * 3 + 2]! += image.data[index + b]! * opacity + 28 * (1 - opacity)
        seen[cell]! += 1
      }
    }
    const quarter = ((turns % 4) + 4) % 4
    const out = { red: [] as number[], green: [] as number[], blue: [] as number[], visible: [] as number[] }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [sx, sy] = quarter === 0 ? [x, y] : quarter === 1 ? [y, sourceHeight - 1 - x] : quarter === 2 ? [sourceWidth - 1 - x, sourceHeight - 1 - y] : [sourceWidth - 1 - y, x]
        const cell = sy * sourceWidth + sx
        out.visible.push(Math.fround(all[cell] ? seen[cell]! / all[cell]! : 0))
        out.red.push(seen[cell] ? Math.fround(sums[cell * 3]! / seen[cell]!) : 0)
        out.green.push(seen[cell] ? Math.fround(sums[cell * 3 + 1]! / seen[cell]!) : 0)
        out.blue.push(seen[cell] ? Math.fround(sums[cell * 3 + 2]! / seen[cell]!) : 0)
      }
    }
    return { width, height, ...out }
  }
  const grey = (picture: ReturnType<typeof thumbnail>, cell: number) => (picture.red[cell]! * 54 + picture.green[cell]! * 183 + picture.blue[cell]! * 19) / 256
  const steps = (picture: ReturnType<typeof thumbnail>, dx: number, dy: number) => {
    let out = ''
    for (let y = 0; y + dy < picture.height; y += 1) {
      for (let x = 0; x + dx < picture.width; x += 1) {
        const a = y * picture.width + x, b = (y + dy) * picture.width + x + dx
        if (picture.visible[a]! < 0.5 || picture.visible[b]! < 0.5) { out += '?'; continue }
        const step = grey(picture, b) - grey(picture, a)
        out += step > 4 ? '+' : step < -4 ? '-' : '0'
      }
    }
    return out
  }
  const colors = thumbnail(4, 4)
  const palette: number[] = []
  for (let cell = 0; cell < 16; cell += 1) {
    if (colors.visible[cell]! < 0.5) palette.push(-1, -1, -1)
    else palette.push(Math.round(colors.red[cell]!), Math.round(colors.green[cell]!), Math.round(colors.blue[cell]!))
  }
  return { steps: steps(thumbnail(9, 8), 1, 0) + steps(thumbnail(8, 9), 0, 1), colors: palette }
}

describe('every turn of a screen picture from one pass over its pixels', () => {
  it('gives exactly the signatures one pass per thumbnail and turn gave', () => {
    // Noise and an icon's transparency: no picture where rounding could hide a difference.
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (const [width, height, alpha] of [[128, 62, false], [251, 182, false], [64, 64, true], [37, 91, true]] as const) {
      const data = Uint8Array.from({ length: width * height * 4 }, () => Math.floor(random() * 256))
      const image: Pixels = { width, height, data, order: alpha ? 'rgba' : 'bgra', alpha }
      const area = { x: 2.4, y: 1.6, width: width - 5.1, height: height - 3.3 }
      const covered = [{ x: width / 3, y: height / 4, width: 15, height: 23 }, { x: 0, y: height - 9, width: width, height: 6 }]
      const turns = [0, 1, 2, 3]
      expect(pictureSignatures(image, area, covered, turns)).toEqual(turns.map((turn) => referenceSignature(image, area, covered, turn)))
      expect(pictureSignature(image, area, [], 1)).toEqual(referenceSignature(image, area, [], 1))
    }
  })
})
