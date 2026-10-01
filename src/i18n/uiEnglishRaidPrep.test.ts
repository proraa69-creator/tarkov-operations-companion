import { describe, expect, it } from 'vitest'
import { exactUiText, translateUiText } from './uiEnglish'
import { RAID_PREP_PHRASES } from './uiEnglishRaidPrep'

describe('English for the raid section', () => {
  it('has every raid-prep phrase as an exact translation', () => {
    for (const [ru, en] of RAID_PREP_PHRASES) expect(exactUiText(ru), ru).toBe(en)
  })

  it('translates the built templates', () => {
    expect(translateUiText('Терапевт · текущее · подойдёт и: 6Б45')).toBe('Терапевт · current · also accepted: 6Б45')
    expect(translateUiText(' или замена (2)')).toBe(' or substitute (2)')
    expect(translateUiText('нужно 3')).toBe('need 3')
    expect(translateUiText('Медблок ур. 2')).toBe('Медблок lvl. 2')
  })
})
