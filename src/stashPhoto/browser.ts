import { usesDataGateway } from '../data/tarkovApi'
import type { LabelStack } from '../kappa/labelScan'
import { stripReader, type OcrLine } from './labels'
import type { PhotoCandidate } from './match'
import type { Rgba } from './raster'
import { fingerprint, type PictureFingerprint } from './signature'

/**
 * The phone's side of «Синхронизация по фото»: the photo decoded into pixels in memory (never uploaded, never saved),
 * the wanted items' inventory pictures, and the OCR engine shipped inside the app (public files under ocr/, put there by
 * the build: vite.config.ts) — nothing is fetched from a CDN.
 */

/** A photo bigger than this (long side) is shrunk first: enough for 60–100 px cells, quick on a phone. */
const MAX_SIDE = 2000

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('canvas')
  return { canvas, context }
}

/** The photo's pixels (turned upright as the camera saw it), shrunk to at most MAX_SIDE. */
export async function photoPixels(file: Blob): Promise<Rgba> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale))
    const { context } = canvasOf(width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    const { data } = context.getImageData(0, 0, width, height)
    return { width, height, data }
  } finally {
    bitmap.close()
  }
}

/** An item's inventory picture (the grid image our server mirrors; tarkov.dev's own address in development). */
export function gridPictureUrl(id: string) {
  return usesDataGateway() ? `https://raidos.app/v1/item-images/${id}-grid.webp` : `https://assets.tarkov.dev/${id}-grid-image.webp`
}

const prints = new Map<string, PictureFingerprint>()

export interface WantedItem { id: string; shortName: string; width: number; height: number }

/** The wanted items with the fingerprints of their pictures (kept for the next photo); an item whose picture fails is left out. */
export async function photoCandidates(items: WantedItem[]): Promise<PhotoCandidate[]> {
  const out: PhotoCandidate[] = []
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!
      const key = `${item.id}:${item.width}x${item.height}`
      let print = prints.get(key)
      if (!print) {
        try {
          const response = await fetch(gridPictureUrl(item.id))
          if (!response.ok) continue
          const bitmap = await createImageBitmap(await response.blob())
          try {
            const { context } = canvasOf(bitmap.width, bitmap.height)
            context.drawImage(bitmap, 0, 0)
            const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
            print = fingerprint({ width: bitmap.width, height: bitmap.height, data }, item.width, item.height)
            prints.set(key, print)
          } finally {
            bitmap.close()
          }
        } catch { continue }
      }
      out.push({ ...item, fingerprint: print })
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  return out
}

type OcrWorker = {
  setParameters(params: Record<string, string>): Promise<unknown>
  recognize(image: HTMLCanvasElement, options: object, output: { blocks: boolean }): Promise<{ data: { blocks?: Array<{ paragraphs: Array<{ lines: Array<{ text: string; bbox: { y0: number; y1: number } }> }> }> | null } }>
  terminate(): Promise<unknown>
}

/**
 * The OCR engine for one photo (Russian and English labels), from the app's own files. Throws when it cannot start;
 * the caller then lets the pictures decide alone. `close()` frees its memory after the photo.
 */
export async function labelEngine(): Promise<{ read: (strips: Rgba[]) => Promise<string[]>; close: () => Promise<void> }> {
  const { createWorker } = await import('tesseract.js')
  const base = new URL('ocr/', document.baseURI).href
  const worker = await createWorker('rus+eng', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}tesseract-core-lstm.wasm.js`,
    langPath: base.replace(/\/$/, ''),
    gzip: false,
    workerBlobURL: false,
  }) as unknown as OcrWorker
  await worker.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '300' })
  const recognize = async (picture: LabelStack): Promise<OcrLine[]> => {
    const { canvas, context } = canvasOf(picture.width, picture.height)
    const image = context.createImageData(picture.width, picture.height)
    for (let p = 0; p < picture.data.length; p += 1) {
      const value = picture.data[p]!
      image.data[p * 4] = value; image.data[p * 4 + 1] = value; image.data[p * 4 + 2] = value; image.data[p * 4 + 3] = 255
    }
    context.putImageData(image, 0, 0)
    const result = await worker.recognize(canvas, {}, { blocks: true })
    return (result.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
      .map((line) => ({ text: line.text, top: line.bbox.y0, bottom: line.bbox.y1 }))
  }
  return { read: stripReader(recognize), close: async () => { await worker.terminate() } }
}
