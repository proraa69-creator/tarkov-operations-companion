/**
 * The picture index of the item key: the icon signature (iconSignature.ts) of every catalog item that can lie in a
 * stash, computed once by scripts/build-item-signatures.mjs from the catalog icons and shipped with the app
 * (public/item-signatures.bin). The item under the cursor is compared with all items of its size at the key press,
 * alongside the tooltip OCR (see pictureIndex.ts), instead of only with the few names an OCR reading suggested.
 *
 * Binary, little-endian: 'RSIG', version (1), steps (128), colours (48), 1 spare byte, item count (u32), build time
 * (u32, seconds); then per item: 12 id bytes (the 24-hex id), cols, rows, the steps two bits each (0 flat, 1 '+',
 * 2 '-', 3 '?'), the colours one byte each. No runtime imports: the build script loads this file directly.
 */
import type { PictureSignature } from './iconSignature.js'

export const SIGNATURE_INDEX_FILE = 'item-signatures.bin'
const MAGIC = [0x52, 0x53, 0x49, 0x47]
const VERSION = 1
const STEPS = 128
const COLORS = 48
const HEADER = 16
const RECORD = 12 + 2 + STEPS / 4 + COLORS
const STEP_CODES = ['0', '+', '-', '?'] as const

export interface IndexedItem {
  id: string
  /** Size in cells as the catalog gives it (the icon's orientation). */
  cols: number
  rows: number
  signature: PictureSignature
}

export interface SignatureIndex {
  items: IndexedItem[]
  /** When the icons were read (ms). */
  builtAt: number
}

const ID = /^[0-9a-f]{24}$/

/** Whether an item's signature fits the format (a 24-hex id, sizes 1–255, 128 steps, 48 colours 0–255). */
export function indexable(item: IndexedItem) {
  return ID.test(item.id) && item.cols >= 1 && item.cols <= 255 && item.rows >= 1 && item.rows <= 255
    && item.signature.steps.length === STEPS && /^[-+0?]+$/.test(item.signature.steps)
    && item.signature.colors.length === COLORS && item.signature.colors.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
}

export function encodeSignatureIndex(items: IndexedItem[], builtAt = Date.now()): Uint8Array {
  const kept = items.filter(indexable)
  const bytes = new Uint8Array(HEADER + kept.length * RECORD)
  const view = new DataView(bytes.buffer)
  bytes.set(MAGIC, 0)
  bytes[4] = VERSION
  bytes[5] = STEPS
  bytes[6] = COLORS
  view.setUint32(8, kept.length, true)
  view.setUint32(12, Math.floor(builtAt / 1000), true)
  kept.forEach((item, index) => {
    let at = HEADER + index * RECORD
    for (let char = 0; char < 24; char += 2) bytes[at++] = parseInt(item.id.slice(char, char + 2), 16)
    bytes[at++] = item.cols
    bytes[at++] = item.rows
    for (let step = 0; step < STEPS; step += 4) {
      let packed = 0
      for (let part = 0; part < 4; part += 1) packed |= STEP_CODES.indexOf(item.signature.steps[step + part] as typeof STEP_CODES[number]) << (part * 2)
      bytes[at++] = packed
    }
    bytes.set(item.signature.colors, at)
  })
  return bytes
}

/** The index from its file, or null when the bytes are not one (another version, cut short). */
export function decodeSignatureIndex(bytes: Uint8Array): SignatureIndex | null {
  if (bytes.length < HEADER || MAGIC.some((value, index) => bytes[index] !== value) || bytes[4] !== VERSION || bytes[5] !== STEPS || bytes[6] !== COLORS) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(8, true)
  if (bytes.length !== HEADER + count * RECORD) return null
  const hex = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, '0'))
  const items: IndexedItem[] = []
  for (let index = 0; index < count; index += 1) {
    let at = HEADER + index * RECORD
    let id = ''
    for (let byte = 0; byte < 12; byte += 1) id += hex[bytes[at++]!]
    const cols = bytes[at++]!, rows = bytes[at++]!
    let steps = ''
    for (let byte = 0; byte < STEPS / 4; byte += 1) {
      const packed = bytes[at++]!
      for (let part = 0; part < 4; part += 1) steps += STEP_CODES[(packed >> (part * 2)) & 3]
    }
    items.push({ id, cols, rows, signature: { steps, colors: Array.from(bytes.subarray(at, at + COLORS)) } })
  }
  return { items, builtAt: view.getUint32(12, true) * 1000 }
}
