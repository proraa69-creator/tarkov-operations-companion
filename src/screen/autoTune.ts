import { NEUTRAL, type ScreenProfile } from './screenCurve'

/**
 * «Подобрать по кадру»: settings worked out from the game's picture itself. The darker the picture (its middle tone and
 * how much of it is near black), the more the middle and the shadows rise; the more bright spots it has (lamps, the
 * sky, a flashlight), the more the brightest tones are held back.
 */
export function autoProfile(pixels: Uint8ClampedArray | Uint8Array): Omit<ScreenProfile, 'id' | 'name'> {
  const histogram = new Array<number>(256).fill(0)
  let count = 0
  // Every 4th pixel is plenty for a histogram.
  for (let index = 0; index < pixels.length; index += 16) {
    const luma = Math.round(0.2126 * pixels[index]! + 0.7152 * pixels[index + 1]! + 0.0722 * pixels[index + 2]!)
    histogram[luma] = (histogram[luma] ?? 0) + 1
    count += 1
  }
  if (!count) return { ...NEUTRAL }
  const share = (from: number, to: number) => histogram.slice(from, to + 1).reduce((sum, value) => sum + value, 0) / count
  let seen = 0, median = 0
  for (let value = 0; value < 256; value += 1) {
    seen += histogram[value]!
    if (seen >= count / 2) { median = value / 255; break }
  }
  const dark = share(0, 20)
  const bright = share(230, 255)
  // The middle tone is brought towards 0.3 (a dim but readable picture), never darker than it is: median^(1/gamma) = 0.3.
  const target = 0.3
  const gamma = median >= target ? 1 : Math.log(Math.max(median, 0.01)) / Math.log(target)
  const round = (value: number) => Math.round(value * 100) / 100
  return {
    ...NEUTRAL,
    gamma: round(Math.min(1.8, Math.max(1, gamma))),
    shadows: round(Math.min(0.22, dark * 0.4)),
    highlights: round(-Math.min(0.2, 0.04 + bright * 1.5)),
    contrast: round(median < 0.12 ? 0.06 : 0.04),
  }
}
