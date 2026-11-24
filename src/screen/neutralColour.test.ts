import { describe, expect, it } from 'vitest'
import { cleanProfile, screenTables, type ScreenProfile } from './screenCurve'

const base: Omit<ScreenProfile, 'id' | 'name'> = { gamma: 1.3, shadows: 0.1, highlights: 0, contrast: 0.05, brightness: 0, temperature: -0.4, tint: -0.6, curve: [], cast: 0.5 }
const spread = (tables: ReturnType<typeof screenTables>, index: number) => Math.max(tables.r[index]!, tables.g[index]!, tables.b[index]!) - Math.min(tables.r[index]!, tables.g[index]!, tables.b[index]!)

// Owner, 11.11.2026: «картинка отдает зеленой… выставить в нейтральное положение… в натуральный цвет».
describe('«Естественный цвет»', () => {
  it('at 100 % the three channels are one: no tint, the light of the preset kept', () => {
    const tinted = screenTables(base)
    const natural = screenTables({ ...base, neutral: 1 })
    expect(spread(tinted, 128)).toBeGreaterThan(0.02)
    for (const index of [8, 40, 128, 220]) expect(spread(natural, index)).toBeLessThan(1e-9)
    // the preset's lifting of the darks stays: brighter than the game's own step
    expect(natural.g[40]!).toBeGreaterThan(40 / 255)
  })

  it('half way halves the tint; every table still rises', () => {
    const half = screenTables({ ...base, neutral: 0.5 })
    expect(spread(half, 128)).toBeCloseTo(spread(screenTables(base), 128) / 2, 6)
    for (const channel of ['r', 'g', 'b'] as const) for (let index = 1; index < 256; index += 1) expect(half[channel][index]!).toBeGreaterThanOrEqual(half[channel][index - 1]!)
  })

  it('is kept with a saved preset', () => {
    expect(cleanProfile({ id: 'x', name: 'Мой', ...base, neutral: 1 })?.neutral).toBe(1)
  })
})
