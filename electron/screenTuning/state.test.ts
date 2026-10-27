import { describe, expect, it } from 'vitest'
import { gammaRamp, NEUTRAL, screenTables } from '../../src/screen/screenCurve'
import { activePreset, cleanSettings, composeRamp, DEFAULT_SETTINGS, deletePreset, MAX_PRESETS, savePreset, writeStrongest } from './state'

let counter = 0
const newId = () => `own-${++counter}`

describe('«Настройка экрана»: what is kept', () => {
  it('drops broken presets, ours by id and repeats; an unknown chosen preset falls back', () => {
    const settings = cleanSettings({
      presets: [{ id: 'builtin-day', name: 'Подмена' }, { id: 'a', name: 'Мой' }, { id: 'a', name: 'Повтор' }, { id: 'b' }],
      activeId: 'missing', enabled: true, when: 'nonsense',
    })
    expect(settings.presets.map((preset) => preset.id)).toEqual(['a'])
    expect(settings.activeId).toBe(DEFAULT_SETTINGS.activeId)
    expect(settings.enabled).toBe(true)
    expect(settings.when).toBe('game')
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('a preset of ours is copied, the player\'s own is replaced; deleting the chosen one falls back', () => {
    const copied = savePreset(DEFAULT_SETTINGS, { id: 'builtin-night-max', name: 'Ночь (моя)', gamma: 1.7 }, newId)
    expect(copied.preset.id).toMatch(/^own-/)
    expect(copied.settings.presets).toHaveLength(1)
    const replaced = savePreset(copied.settings, { ...copied.preset, name: 'Ночь на Таможне' }, newId)
    expect(replaced.settings.presets.map((preset) => preset.name)).toEqual(['Ночь на Таможне'])
    const chosen = { ...replaced.settings, activeId: copied.preset.id }
    expect(activePreset(chosen).name).toBe('Ночь на Таможне')
    expect(deletePreset(chosen, copied.preset.id)).toMatchObject({ presets: [], activeId: DEFAULT_SETTINGS.activeId })
    expect(() => savePreset(DEFAULT_SETTINGS, { name: '' }, newId)).toThrow(/название/)
  })

  it(`keeps at most ${MAX_PRESETS} presets of the player`, () => {
    let settings = DEFAULT_SETTINGS
    for (let index = 0; index < MAX_PRESETS; index += 1) settings = savePreset(settings, { name: `P${index}` }, newId).settings
    expect(() => savePreset(settings, { name: 'one more' }, newId)).toThrow(/30/)
  })
})

describe('«Настройка экрана»: the ramp written to the monitor', () => {
  it('keeps a calibrated monitor\'s own ramp under ours', () => {
    const neutral = screenTables(NEUTRAL)
    const calibrated = gammaRamp(screenTables({ ...NEUTRAL, temperature: 0.5 }))
    expect(Array.from(composeRamp(neutral, calibrated))).toEqual(Array.from(calibrated))
    expect(Array.from(composeRamp(neutral, null))).toEqual(Array.from(gammaRamp(neutral)))
  })

  it('goes weaker step by step while Windows refuses, and reports 0 when it refuses every one', () => {
    const tables = screenTables({ ...NEUTRAL, gamma: 2.5 })
    const tried: number[] = []
    const strength = writeStrongest(tables, null, (ramp) => { tried.push(ramp[64]!); return tried.length === 3 })
    expect(strength).toBe(0.7)
    expect(tried[0]!).toBeGreaterThan(tried[2]!)
    expect(writeStrongest(tables, null, () => false)).toBe(0)
  })
})
