import { describe, expect, it } from 'vitest'
import { applyTables, BUILT_IN_PRESETS, byteTables, cleanProfile, curveFunction, gammaRamp, isNeutral, NEUTRAL, screenTables, weakerTables } from './screenCurve'

const rising = (table: ArrayLike<number>) => Array.from(table).every((value, index, all) => index === 0 || value >= all[index - 1]!)

describe('«Настройка экрана»: the curve', () => {
  it('is a straight line without points and passes through every point it is given', () => {
    const line = curveFunction([])
    expect(line(0.25)).toBeCloseTo(0.25)
    const curve = curveFunction([{ x: 0, y: 0 }, { x: 0.2, y: 0.35 }, { x: 0.6, y: 0.7 }, { x: 1, y: 1 }])
    expect(curve(0.2)).toBeCloseTo(0.35)
    expect(curve(0.6)).toBeCloseTo(0.7)
  })

  it('never falls between rising points (no tone turns darker than a darker one)', () => {
    const curve = curveFunction([{ x: 0.1, y: 0.4 }, { x: 0.15, y: 0.42 }, { x: 0.9, y: 0.95 }])
    expect(rising(Array.from({ length: 256 }, (_, index) => curve(index / 255)))).toBe(true)
  })
})

describe('«Настройка экрана»: tables and the gamma ramp', () => {
  it('a neutral profile changes nothing', () => {
    expect(isNeutral(NEUTRAL)).toBe(true)
    expect(isNeutral(BUILT_IN_PRESETS[0]!)).toBe(true)
    const ramp = gammaRamp(screenTables(NEUTRAL))
    expect(ramp.length).toBe(768)
    expect(ramp[0]).toBe(0)
    expect(ramp[255]).toBe(65535)
    expect(ramp[256 + 128]).toBe(Math.round(128 / 255 * 65535))
  })

  it('every preset of ours rises, keeps black nearly black (no grey veil) and brightens the dark third', () => {
    for (const preset of BUILT_IN_PRESETS.slice(1)) {
      const tables = screenTables(preset)
      for (const channel of ['r', 'g', 'b'] as const) {
        expect(rising(tables[channel]), `${preset.name} ${channel}`).toBe(true)
        expect(tables[channel][0]! * 255, preset.name).toBeLessThan(36)
      }
      expect(tables.g[40]!, preset.name).toBeGreaterThan(40 / 255)
    }
  })

  it('the night presets lift a dark corner a lot and leave the brightest tones bright', () => {
    const night = screenTables(BUILT_IN_PRESETS.find((preset) => preset.id === 'builtin-dark-max')!)
    expect(night.g[25]! * 255).toBeGreaterThan(55)
    expect(night.g[255]! * 255).toBeGreaterThan(235)
    // Tarkov's dark (green 7…11): the game's black stays dark, the room's steps right above it come out lit
    expect(night.g[7]! * 255).toBeLessThan(36)
    expect(night.g[10]! * 255).toBeGreaterThan(90)
    // the red cast filter: red's black (10) lands with green's (7)
    expect(Math.abs(night.r[10]! - night.g[7]!) * 255).toBeLessThan(8)
  })

  it('a warm main colour adds red and takes blue', () => {
    const warm = screenTables({ ...NEUTRAL, temperature: 1 })
    expect(warm.r[200]!).toBeGreaterThan(warm.b[200]!)
    const cold = screenTables({ ...NEUTRAL, temperature: -1 })
    expect(cold.b[200]!).toBeGreaterThan(cold.r[200]!)
  })

  it('a weaker ramp goes part of the way from the straight line', () => {
    const tables = screenTables({ ...NEUTRAL, gamma: 2 })
    const half = weakerTables(tables, 0.5)
    expect(half.g[64]!).toBeCloseTo(64 / 255 + (tables.g[64]! - 64 / 255) / 2)
  })

  it('colours a picture with the same tables', () => {
    const pixels = new Uint8ClampedArray([20, 20, 20, 255])
    applyTables(pixels, byteTables(screenTables({ ...NEUTRAL, gamma: 1.6 })))
    expect(pixels[0]).toBeGreaterThan(40)
    expect(pixels[3]).toBe(255)
  })
})

describe('«Настройка экрана»: a stored profile', () => {
  it('keeps every value in its range and drops what is not a profile', () => {
    const profile = cleanProfile({ id: 'p1', name: '  Ночь  ', gamma: 9, shadows: -1, curve: [{ x: 2, y: 0.5 }], channels: { r: [{ x: 0.5, y: 0.6 }] }, vibrance: 300, evil: true })
    expect(profile).toEqual({ id: 'p1', name: 'Ночь', gamma: 2.5, shadows: 0, highlights: 0, contrast: 0, brightness: 0, temperature: 0, tint: 0, curve: [{ x: 1, y: 0.5 }], channels: { r: [{ x: 0.5, y: 0.6 }] }, vibrance: 100 })
    expect(cleanProfile({ id: '', name: 'x' })).toBeNull()
    expect(cleanProfile('x')).toBeNull()
  })
})
