import { describe, expect, it } from 'vitest'
import { exactUiText, translateUiText } from './uiEnglish'
import { SCREEN_PHRASES } from './uiEnglishScreen'
import { BUILT_IN_PRESETS } from '../screen/screenCurve'
import { HEAVY_PROGRAMS } from '../../electron/screenTuning/optimizer'

describe('English for «Настройка экрана»', () => {
  it('has every phrase as an exact translation', () => {
    for (const [ru, en] of SCREEN_PHRASES) expect(exactUiText(ru), ru).toBe(en)
  })

  it('translates our presets and why a program is heavy', () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(exactUiText(preset.name), preset.name).toBeTruthy()
      if (preset.note) expect(exactUiText(preset.note), preset.note).toBeTruthy()
    }
    for (const program of HEAVY_PROGRAMS) expect(exactUiText(program.why), program.why).toBeTruthy()
  })

  it('translates an optimizer step that failed', () => {
    expect(translateUiText('Игровой режим Windows включён: не получилось')).toBe('Windows Game Mode is on: failed')
  })
})
