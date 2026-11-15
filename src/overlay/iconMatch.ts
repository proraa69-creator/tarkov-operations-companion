/**
 * The picture check of the second attempt. When the tooltip's text names no item, the item's picture under the cursor
 * is compared with the catalog icons of the items the text could be — only those, never a search of the whole catalog
 * — and an item is answered only when its icon is close enough AND clearly closer than every other candidate's.
 * Weapons are left out: a modded gun does not look like its reference picture.
 *
 * The screen side (findItemCell, screenPicture) runs where the screen grab is; icons are decoded where the catalog is.
 */
import type { Bitmap, Rect } from './tooltipDetect.js'
import type { ItemCell } from './itemCell.js'
import { iconArea, pictureSignature, signatureDistance, type PictureSignature, type Pixels, type SignatureDistance } from './iconSignature.js'

/** Thresholds of the picture check (distances: 0 = same picture, unrelated pictures ≈ 0.3–0.5; see iconSignature.ts). */
export const PICTURE_MATCH = {
  /** Text candidates whose icons are compared. */
  candidates: 8,
  /**
   * The screen picture must be at least this close to the icon… Measured on 250 synthetic inventory scenes (grid,
   * neighbours, labels, cursor and tooltip over the item, 0.75×–2× UI scale, tinted, some rotated): the same item
   * 0.03–0.34 (median 0.11, p95 0.18), the closest of 299 other pictures ≥ 0.21 (p5 0.28), a look-alike with one part
   * recoloured 0.05–0.34 (median 0.14). Not yet measured on real game frames.
   */
  maxDistance: 0.15,
  /** …and this much closer than any other candidate's icon (a look-alike among the candidates means no answer). */
  minMargin: 0.08,
  /** Share of the signature that must be visible: the tooltip, the cursor and the labels cover the rest. */
  minKnown: 0.4,
  /** Other candidates count as rivals with at least this much visible (less is too noisy to tell anything). */
  rivalKnown: 0.2,
  /** A candidate needs at least this text score… */
  minText: 0.45,
  /** …and no more than this below the best text candidate: the picture only chooses among plausible names. */
  textLead: 0.25,
  /** A candidate of another size read this much better than the match blocks it (the size is only an estimate). */
  sizeLead: 0.1,
  /** A reading is remembered as the item found only when it reads at least this much like the item's name. */
  memoryText: 0.5,
}

/** The screen picture under the cursor, ready to be compared: one entry per layout findItemCell gave. */
export interface ScreenPicture {
  grid: boolean
  layouts: Array<{
    cols: number
    rows: number
    /** Signatures by quarter turns clockwise that bring the screen picture into the icon's orientation (0; 1 and 3
     * for an item that may lie rotated). */
    turns: Partial<Record<'0' | '1' | '3', PictureSignature>>
  }>
}

export function screenPicture(image: Bitmap, cell: ItemCell, options: { backdrop?: boolean } = {}): ScreenPicture {
  const pixels: Pixels = { ...image, order: 'bgra' }
  const layouts: ScreenPicture['layouts'] = []
  for (const layout of cell.layouts) {
    const variants: Array<{ source: Pixels; rect: Rect; covered: Rect[] }> = [{ source: pixels, rect: layout.rect, covered: layout.covered }]
    if (options.backdrop) {
      const local = withBackdrop(image, layout.rect)
      if (local) variants.push({ source: local, rect: { x: 0, y: 0, width: layout.rect.width, height: layout.rect.height }, covered: layout.covered.map((part) => ({ ...part, x: part.x - layout.rect.x, y: part.y - layout.rect.y })) })
    }
    for (const { source, rect, covered } of variants) {
      layouts.push({
        cols: layout.cols,
        rows: layout.rows,
        turns: {
          0: pictureSignature(source, rect, covered, 0),
          ...(layout.cols !== layout.rows ? { 1: pictureSignature(source, rect, covered, 1), 3: pictureSignature(source, rect, covered, 3) } : {}),
        },
      })
    }
  }
  return { grid: cell.grid, layouts }
}

/** Colour distance (sum over channels) within which a pixel counts as the item's background. */
const BACKDROP_TOLERANCE = 36
/** The dark cell a transparent icon pixel stands for in its signature (iconSignature.ts BACKDROP). */
const ICON_BACKDROP = 28

/**
 * The item's area with its background (the game fills an item's cells with a semi-transparent tint: grey, blue,
 * yellow…) painted the dark the icon signatures stand for under a transparent pixel — measured on logged lookups: a
 * grey-backed roll of tape 0.32 → 0.16 from its icon. The background is the median colour along the area's edge.
 * Null when the area is empty. BGRA in, BGRA out (a copy of just the area).
 */
export function withBackdrop(image: Bitmap, rect: Rect): Pixels | null {
  const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y))
  const width = Math.min(image.width, Math.round(rect.x + rect.width)) - x0, height = Math.min(image.height, Math.round(rect.y + rect.height)) - y0
  if (width < 4 || height < 4) return null
  const edge: number[][] = [[], [], []]
  const sample = (x: number, y: number) => {
    const index = (y * image.width + x) * 4
    for (let channel = 0; channel < 3; channel += 1) edge[channel]!.push(image.data[index + channel]!)
  }
  for (let x = x0; x < x0 + width; x += 1) { sample(x, y0 + 1); sample(x, y0 + height - 2) }
  for (let y = y0; y < y0 + height; y += 1) { sample(x0 + 1, y); sample(x0 + width - 2, y) }
  const background = edge.map((values) => values.sort((a, b) => a - b)[values.length >> 1]!)
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const from = ((y0 + y) * image.width + x0) * 4
    data.set(image.data.subarray(from, from + width * 4), y * width * 4)
  }
  for (let index = 0; index < data.length; index += 4) {
    const distance = Math.abs(data[index]! - background[0]!) + Math.abs(data[index + 1]! - background[1]!) + Math.abs(data[index + 2]! - background[2]!)
    if (distance <= BACKDROP_TOLERANCE) data[index] = data[index + 1] = data[index + 2] = ICON_BACKDROP
    data[index + 3] = 255
  }
  return { width, height, data, order: 'bgra' }
}

/** The signature of a catalog icon of a cols×rows item. */
export function iconSignature(icon: Pixels, cols: number, rows: number) {
  return pictureSignature(icon, iconArea(icon.width, icon.height, cols, rows))
}

/** How close the screen picture is to the icon, with the layout of the item's size (turned if it lies rotated); null when no layout has its size. */
export function candidateDistance(screen: ScreenPicture, size: { cols: number; rows: number }, icon: PictureSignature): SignatureDistance | null {
  let best: SignatureDistance | null = null
  for (const layout of screen.layouts) {
    const turns = size.cols === layout.cols && size.rows === layout.rows ? (['0'] as const)
      : size.cols !== size.rows && size.cols === layout.rows && size.rows === layout.cols ? (['1', '3'] as const) : []
    for (const turn of turns) {
      const signature = layout.turns[turn]
      if (!signature) continue
      const distance = signatureDistance(signature, icon)
      if (!best || distance.distance < best.distance) best = distance
    }
  }
  return best
}

/** A text candidate as the picture check sees it. */
export interface PictureCandidate {
  id: string
  /** Text score of the candidate (rank of the readings, 1 = the name read exactly). */
  text: number
  /** The comparison, or why there is none: 'size' (the item under the cursor has another size), 'weapon',
   * 'no-icon' (no picture in the catalog or it could not be loaded), 'no-size' (catalog lacks the item's size). */
  distance: SignatureDistance | 'size' | 'weapon' | 'no-icon' | 'no-size'
}

export interface PictureVerdict {
  id: string | null
  reason: 'match' | 'no-candidates' | 'too-far' | 'covered' | 'no-margin' | 'unchecked-rival' | 'not-plausible'
}

/** The item the picture shows among the candidates — or none (see PICTURE_MATCH for the rules). */
export function decideByPicture(candidates: PictureCandidate[], limits = PICTURE_MATCH): PictureVerdict {
  const topText = Math.max(0, ...candidates.map((candidate) => candidate.text))
  const plausible = (candidate: PictureCandidate) => candidate.text >= limits.minText && candidate.text >= topText - limits.textLead
  const compared = candidates.flatMap((candidate) => typeof candidate.distance === 'object' ? [{ ...candidate, distance: candidate.distance }] : [])
  if (!compared.length) return { id: null, reason: 'no-candidates' }
  compared.sort((a, b) => a.distance.distance - b.distance.distance)
  const best = compared[0]!
  if (best.distance.known < limits.minKnown) return { id: null, reason: 'covered' }
  if (best.distance.distance > limits.maxDistance) return { id: null, reason: 'too-far' }
  const rival = compared.find((candidate) => candidate.id !== best.id && candidate.distance.known >= limits.rivalKnown)
  if (rival && rival.distance.distance - best.distance.distance < limits.minMargin) return { id: null, reason: 'no-margin' }
  if (!plausible(best)) return { id: null, reason: 'not-plausible' }
  // A name read at least as well whose picture could not be compared might be the item (its icon failed to load), and
  // one read clearly better that seemed to have another size might be it too (the size is an estimate).
  const unchecked = (candidate: PictureCandidate) => candidate.distance === 'no-icon' || candidate.distance === 'weapon' || candidate.distance === 'no-size'
    ? candidate.text >= best.text
    : candidate.distance === 'size' && candidate.text >= best.text + limits.sizeLead
  if (candidates.some((candidate) => candidate.id !== best.id && unchecked(candidate))) return { id: null, reason: 'unchecked-rival' }
  return { id: best.id, reason: 'match' }
}

/** The text candidates the main process fetches icons for (answer to the renderer's 'item-candidates'). */
export interface PictureCandidatesAnswer {
  candidates: Array<{ itemId: string; iconUrl?: string; /** Its icon signature is known already: nothing to fetch. */ known: boolean }>
}

/** What the main process sends for the check ('item-picture'). */
export interface PictureQuery {
  texts: string[]
  screen: ScreenPicture
  /** Icon bytes (base64) by item id, for the candidates whose signature the renderer did not know yet. */
  icons: Record<string, string>
  /** Icon signatures from the picture index (signatureIndex.ts) by item id: no fetch needed for these. */
  signatures?: Record<string, PictureSignature>
  /** The closest pictures of the whole catalog (pictureIndex.ts): candidates too, whatever the readings suggested. */
  nearby?: string[]
}

/** The renderer's answer: the item card (or «not found») and every candidate's comparison, for the diagnostics log. */
export interface PictureAnswer<Payload = unknown> {
  payload: Payload
  reason: PictureVerdict['reason']
  candidates: Array<{ itemId: string; name: string; text: number; distance?: number; shape?: number; tint?: number; known?: number; skipped?: string }>
}

/** Whether a catalog picture address may be fetched for the check: an https item icon, nothing else. */
const ICON_HOSTS = new Set(['assets.tarkov.dev', 'raidos.app'])

export function isItemIconUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 300) return false
  try {
    const url = new URL(raw)
    // Only the catalog's icon hosts (tarkov.dev, or the server's own copy — RAIDOS_ITEM_IMAGE_URL): the main process
    // downloads these, so a crafted candidate list cannot send it anywhere else.
    return url.protocol === 'https:' && ICON_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port && !url.search && !url.hash
      && /^[a-z0-9]{16,48}-icon\.(?:webp|png|jpe?g)$/.test(url.pathname.split('/').pop() ?? '')
  } catch {
    return false
  }
}

/** Icon bytes (base64, as passed between the app's processes) → RGBA pixels. Browser only. */
export async function decodeIcon(base64: string): Promise<Pixels | null> {
  try {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes]))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const pixels: Pixels = { width: bitmap.width, height: bitmap.height, data, order: 'rgba', alpha: true }
    bitmap.close()
    return pixels
  } catch {
    return null
  }
}
