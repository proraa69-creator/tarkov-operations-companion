import { describe, expect, it } from 'vitest'
import { classifyLoyaltyBadge, confirmLoyalty, traderBadgeRects } from './traderLoyalty'
import badges from './__fixtures__/traderBadges.json'
import type { OcrWordBox } from './storyPaneLayout'

/** The badges of the owner's screenshot (13.10.2026): Прапор … Реф — crown, crown, I, crown, crown, crown, III, crown, III. */
const decoded = (badges as Array<{ level: number; width: number; height: number; gray: string }>).map((badge) => ({ ...badge, pixels: Uint8Array.from(atob(badge.gray), (char) => char.charCodeAt(0)) }))

/** A synthetic badge: light square, dark strokes with serifs (for «II», which the screenshots do not show). */
function numeral(strokes: number, size = 30) {
  const pixels = new Uint8Array(size * size).fill(40)
  for (let y = 3; y < size - 4; y += 1) for (let x = 3; x < size - 3; x += 1) pixels[y * size + x] = 235
  const left = Math.round(size / 2 - (strokes - 1) * 3.5)
  for (let s = 0; s < strokes; s += 1) {
    const x = left + s * 7
    for (let y = 8; y < size - 9; y += 1) pixels[y * size + x] = 20
    for (let dx = -2; dx <= 2; dx += 1) { pixels[8 * size + x + dx] = 60; pixels[(size - 10) * size + x + dx] = 60 }
  }
  return pixels
}

describe('trader loyalty badges', () => {
  it('reads every badge of the owner\'s screenshot: the crown and the numerals', () => {
    expect(decoded.map((badge) => classifyLoyaltyBadge(badge.pixels, badge.width, badge.height))).toEqual(decoded.map((badge) => badge.level))
  })

  it('tells I, II and III by their strokes', () => {
    expect([1, 2, 3].map((count) => classifyLoyaltyBadge(numeral(count), 30, 30))).toEqual([1, 2, 3])
  })

  it('gives nothing for a dark corner, a plain light square or a picture', () => {
    expect(classifyLoyaltyBadge(new Uint8Array(900).fill(30), 30, 30)).toBeNull()
    expect(classifyLoyaltyBadge(new Uint8Array(900).fill(230), 30, 30)).toBeNull()
    const noise = Uint8Array.from({ length: 900 }, (_, index) => (index * 7919) % 256)
    expect(classifyLoyaltyBadge(noise, 30, 30)).toBeNull()
  })

  it('places each badge from the names under the portraits', () => {
    const word = (text: string, x0: number, x1: number): OcrWordBox => ({ text, bbox: { x0, y0: 140, x1, y1: 154 } })
    const rects = traderBadgeRects([word('Прапор', 105, 167), word('Терапевт', 262, 338), word('Скупщик', 430, 502), word('Механик', 930, 1002)], { width: 1566, height: 880 })
    expect(rects.map((badge) => badge.key)).toEqual(['prapor', 'therapist', 'fence', 'mechanic'])
    // Терапевт's badge on the screenshot: x 233–261, y 19–45.
    const therapist = rects[1]!.rect
    expect(therapist.x).toBeLessThanOrEqual(233)
    expect(therapist.x + therapist.width).toBeGreaterThanOrEqual(258)
    expect(therapist.y).toBeLessThanOrEqual(19)
    expect(therapist.y + therapist.height).toBeGreaterThanOrEqual(40)
  })

  it('counts a level only when two frames agree', () => {
    expect(confirmLoyalty({ prapor: 4, therapist: 2 }, { prapor: 4, therapist: 3 })).toEqual({ prapor: 4 })
  })
})
