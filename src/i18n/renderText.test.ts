import { afterEach, describe, expect, it } from 'vitest'
import { installCatalogTranslations, setRenderLanguage, uiLabel, uiText } from './renderText'

afterEach(() => { setRenderLanguage('ru'); installCatalogTranslations([]) })

describe('interface labels that are also item names', () => {
  it('keeps the map tool «Рулетка» a «Ruler» in English while the item of that name stays «MTape»', () => {
    installCatalogTranslations([['Рулетка', 'MTape']])
    setRenderLanguage('en')
    expect(uiText('Рулетка')).toBe('MTape')
    expect(uiLabel('Рулетка')).toBe('Ruler')
    setRenderLanguage('ru')
    expect(uiLabel('Рулетка')).toBe('Рулетка')
  })
})
