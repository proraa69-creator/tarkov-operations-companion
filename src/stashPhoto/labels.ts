import { stackCrops, type LabelStack } from '../kappa/labelScan'
import type { Rgba } from './raster'

/** One line OCR found in a stacked picture, with the rows it covers. */
export interface OcrLine { text: string; top: number; bottom: number }

/** Strips read per OCR picture: a tall stack of a whole stash reads slower than a few short ones. */
const PER_PICTURE = 40

/**
 * Label strips read by one OCR engine: stacked into pictures of light ink turned black on white (kappa/labelScan.ts, the
 * same preparation as the Windows app's Kappa scan), each OCR line given back to the strip whose rows it covers most.
 */
export function stripReader(recognize: (picture: LabelStack) => Promise<OcrLine[]>) {
  return async (strips: Rgba[]): Promise<string[]> => {
    const texts: string[] = new Array(strips.length).fill('')
    for (let start = 0; start < strips.length; start += PER_PICTURE) {
      const part = strips.slice(start, start + PER_PICTURE)
      const stack = stackCrops(part.map((strip) => ({ ...strip, order: 'rgba' as const })), 2)
      const lines = await recognize(stack)
      for (const line of lines) {
        let best = -1, overlap = 0
        stack.bands.forEach((band, index) => {
          const shared = Math.min(band.bottom, line.bottom) - Math.max(band.top, line.top)
          if (shared > overlap) { overlap = shared; best = index }
        })
        if (best >= 0 && line.text.trim()) texts[start + best] = `${texts[start + best]} ${line.text.trim()}`.trim()
      }
    }
    return texts
  }
}
