/**
 * Drawing the sticker (src/admin/stickers/StickerEditor.tsx): the cut-out photo where the owner put it, maybe with a
 * white outline, and the words over it — on the editor's preview (over a checkerboard, with the chosen words marked) and
 * into the transparent PNG that is uploaded (at most STICKER_LIMITS.bytes; a busy photo is saved a little smaller).
 */
import { STICKER_LIMITS } from '../../shared/supportStickers'
import { dataUrlBase64, fontCss, layoutText, outlineOffsets, PNG_SIDES, STICKER_SIDE, type Rect, type TextLayer, type TextLayout, type View } from './stickerLayout'

/** The photo being made into a sticker: its pixels, the cut-out mask and the cut-out itself (the pixels with the mask). */
export interface StickerPhoto {
  width: number
  height: number
  pixels: ImageData
  mask: Uint8ClampedArray
  cut: HTMLCanvasElement
}

export interface StickerScene { photo: StickerPhoto; view: View; texts: readonly TextLayer[]; outline: boolean }

/** The white outline's width around the cut-out, in frame pixels. */
export const OUTLINE_WIDTH = 7

export function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Этот телефон не умеет рисовать картинки')
  return { canvas, context }
}

/** Writes the mask into the cut-out (its opacity) within `rect` (all of it without one). */
export function updateCut(photo: StickerPhoto, rect: Rect | null = null) {
  const area = rect ?? { x: 0, y: 0, width: photo.width, height: photo.height }
  if (area.width <= 0 || area.height <= 0) return
  const context = photo.cut.getContext('2d')
  if (!context) return
  const part = context.createImageData(area.width, area.height)
  const source = photo.pixels.data
  for (let y = 0; y < area.height; y += 1) {
    for (let x = 0; x < area.width; x += 1) {
      const from = (area.y + y) * photo.width + area.x + x
      const to = (y * area.width + x) * 4
      part.data[to] = source[from * 4]!
      part.data[to + 1] = source[from * 4 + 1]!
      part.data[to + 2] = source[from * 4 + 2]!
      part.data[to + 3] = Math.min(source[from * 4 + 3]!, photo.mask[from]!)
    }
  }
  context.putImageData(part, area.x, area.y)
}

/** The measure of a text layer's lines in its font. */
export function measurer(context: CanvasRenderingContext2D, layer: TextLayer) {
  context.font = fontCss(layer.font, layer.size)
  return (line: string) => context.measureText(line).width
}

/** Where each text layer is drawn (also what a tap on the preview hits). */
export function layoutTexts(context: CanvasRenderingContext2D, texts: readonly TextLayer[]): TextLayout[] {
  return texts.map((layer) => layoutText(layer, measurer(context, layer)))
}

function drawCheckerboard(context: CanvasRenderingContext2D) {
  const cell = 16
  context.fillStyle = '#2b2f2c'
  context.fillRect(0, 0, STICKER_SIDE, STICKER_SIDE)
  context.fillStyle = '#3a3f3b'
  for (let y = 0; y < STICKER_SIDE; y += cell) for (let x = (y / cell) % 2 ? cell : 0; x < STICKER_SIDE; x += cell * 2) context.fillRect(x, y, cell, cell)
}

function drawPhoto(context: CanvasRenderingContext2D, scene: StickerScene) {
  const { photo, view } = scene
  const width = photo.width * view.scale
  const height = photo.height * view.scale
  if (scene.outline) {
    // The silhouette drawn around itself in white, then the photo over it.
    const { canvas: ring, context: ringContext } = canvas2d(STICKER_SIDE, STICKER_SIDE)
    for (const offset of outlineOffsets()) ringContext.drawImage(photo.cut, view.x + offset.x * OUTLINE_WIDTH, view.y + offset.y * OUTLINE_WIDTH, width, height)
    ringContext.globalCompositeOperation = 'source-in'
    ringContext.fillStyle = '#ffffff'
    ringContext.fillRect(0, 0, STICKER_SIDE, STICKER_SIDE)
    context.drawImage(ring, 0, 0)
  }
  context.drawImage(photo.cut, view.x, view.y, width, height)
}

function drawTexts(context: CanvasRenderingContext2D, texts: readonly TextLayer[], layouts: readonly TextLayout[]) {
  texts.forEach((layer, index) => {
    const layout = layouts[index]!
    context.save()
    context.font = fontCss(layer.font, layer.size)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.miterLimit = 2
    layout.lines.forEach((line, row) => {
      const y = layout.ys[row]!
      if (layer.strokeWidth > 0) {
        if (layer.shadow) Object.assign(context, { shadowColor: 'rgba(0, 0, 0, 0.55)', shadowBlur: 8, shadowOffsetY: 3 })
        context.strokeStyle = layer.stroke
        context.lineWidth = layer.strokeWidth * 2
        context.strokeText(line, layout.x, y)
        Object.assign(context, { shadowColor: 'transparent', shadowBlur: 0, shadowOffsetY: 0 })
      } else if (layer.shadow) Object.assign(context, { shadowColor: 'rgba(0, 0, 0, 0.6)', shadowBlur: 8, shadowOffsetY: 3 })
      context.fillStyle = layer.color
      context.fillText(line, layout.x, y)
    })
    context.restore()
  })
}

/**
 * Draws the sticker on `context` (a STICKER_SIDE frame; scaled by `side`). The preview adds the checkerboard, a frame
 * around the chosen words and the brush's circle.
 */
export function drawSticker(context: CanvasRenderingContext2D, scene: StickerScene, options: { side?: number; preview?: boolean; selected?: number | null; brush?: { x: number; y: number; radius: number } | null } = {}) {
  const side = options.side ?? STICKER_SIDE
  context.setTransform(side / STICKER_SIDE, 0, 0, side / STICKER_SIDE, 0, 0)
  context.clearRect(0, 0, STICKER_SIDE, STICKER_SIDE)
  if (options.preview) drawCheckerboard(context)
  drawPhoto(context, scene)
  const layouts = layoutTexts(context, scene.texts)
  drawTexts(context, scene.texts, layouts)
  if (options.preview) {
    const index = scene.texts.findIndex((layer) => layer.id === options.selected)
    const box = index >= 0 ? layouts[index]?.box : undefined
    if (box) {
      context.save()
      context.setLineDash([8, 6])
      context.lineWidth = 2
      context.strokeStyle = '#d8b25a'
      context.strokeRect(box.x - 4, box.y - 4, box.width + 8, box.height + 8)
      context.restore()
    }
    if (options.brush) {
      context.save()
      context.lineWidth = 2
      context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      context.beginPath()
      context.arc(options.brush.x, options.brush.y, options.brush.radius, 0, Math.PI * 2)
      context.stroke()
      context.restore()
    }
  }
  context.setTransform(1, 0, 0, 1, 0, 0)
  return layouts
}

function blobOf(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не удалось сохранить картинку'))), 'image/png'))
}

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(dataUrlBase64(String(reader.result)))
    reader.onerror = () => reject(new Error('Не удалось сохранить картинку'))
    reader.readAsDataURL(blob)
  })
}

/** The sticker as a transparent PNG (base64) within STICKER_LIMITS.bytes: 512 × 512, or smaller for a busy photo. */
export async function exportSticker(scene: StickerScene): Promise<{ data: string; side: number; bytes: number }> {
  for (const side of PNG_SIDES) {
    const { canvas, context } = canvas2d(side, side)
    drawSticker(context, scene, { side })
    const blob = await blobOf(canvas)
    if (blob.size <= STICKER_LIMITS.bytes) return { data: await base64Of(blob), side, bytes: blob.size }
  }
  throw new Error('Стикер слишком большой — сотрите часть фона')
}
