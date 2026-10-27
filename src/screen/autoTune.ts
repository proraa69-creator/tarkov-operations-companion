import { liftCurve, NEUTRAL, type ScreenProfile } from './screenCurve'

/**
 * «Подобрать по кадру»: settings worked out from the game's picture itself. A dark picture (Tarkov's night and its rooms:
 * most of it a few steps above black) gets a night curve that starts right at its own noise floor, with both filters on;
 * a red-brown one gets the red cast taken out. A lighter picture gets a gentle rise of the middle and the shadows.
 */
export function autoProfile(pixels: Uint8ClampedArray | Uint8Array): Omit<ScreenProfile, 'id' | 'name'> {
  const histogram = new Array<number>(256).fill(0)
  let count = 0, redOverGreen = 0, darkCount = 0
  // Every 4th pixel is plenty for a histogram.
  for (let index = 0; index < pixels.length; index += 16) {
    const r = pixels[index]!, g = pixels[index + 1]!, b = pixels[index + 2]!
    const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    histogram[luma] = (histogram[luma] ?? 0) + 1
    count += 1
    if (luma < 24) { redOverGreen += r - g; darkCount += 1 }
  }
  if (!count) return { ...NEUTRAL }
  const share = (from: number, to: number) => histogram.slice(from, to + 1).reduce((sum, value) => sum + value, 0) / count
  let seen = 0, median = 0
  for (let value = 0; value < 256; value += 1) {
    seen += histogram[value]!
    if (seen >= count / 2) { median = value; break }
  }
  const round = (value: number) => Math.round(value * 100) / 100
  // Night and dark rooms: half the picture within a few steps of black.
  if (median < 30) {
    const floor = Math.min(14, Math.max(4, median))
    const level = median < 14 ? 60 : 48
    const cast = darkCount && redOverGreen / darkCount >= 2 ? 1 : 0
    return { ...NEUTRAL, curve: liftCurve(floor, level, 0.8), denoise: floor, ...(cast ? { cast } : {}) }
  }
  const dark = share(0, 20)
  const bright = share(230, 255)
  // The middle tone is brought towards 0.3 (a dim but readable picture), never darker than it is: median^(1/gamma) = 0.3.
  const target = 0.3
  const gamma = median / 255 >= target ? 1 : Math.log(median / 255) / Math.log(target)
  return {
    ...NEUTRAL,
    gamma: round(Math.min(1.8, Math.max(1, gamma))),
    shadows: round(Math.min(0.22, dark * 0.4)),
    highlights: round(-Math.min(0.2, 0.04 + bright * 1.5)),
    contrast: 0.04,
  }
}
