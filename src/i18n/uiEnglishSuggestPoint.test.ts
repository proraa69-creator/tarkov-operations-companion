import { describe, expect, it } from 'vitest'
import { POINT_SUGGESTION_BLOCKS, pointSuggestionLabel } from '../shared/pointSuggestion'
import { SUGGEST_POINT_PHRASES } from './uiEnglishSuggestPoint'
import { POINT_BONUS, POINT_CONDITION } from '../components/SuggestPointSection'

describe('English for «Добавить точку»', () => {
  it('translates the condition, the rows, every emblem and the server answers', async () => {
    const { setRenderLanguage, uiText } = await import('./renderText')
    setRenderLanguage('en')
    try {
      expect(uiText('Добавить точку')).toBe('Add a point')
      expect(uiText(POINT_CONDITION)).toBe('To confirm a point, send a screenshot from the game: the point goes on the map by its coordinates.')
      expect(uiText(POINT_BONUS)).toMatch(/1 bonus/)
      for (const block of POINT_SUGGESTION_BLOCKS) {
        expect(uiText(block.title)).not.toMatch(/[А-Яа-яЁё]/)
        for (const icon of block.icons) expect(uiText(pointSuggestionLabel(icon)), icon).not.toMatch(/[А-Яа-яЁё]/)
      }
      expect(uiText('В имени скриншота нет координат. Нужен скриншот из игры, файл не переименовывать')).not.toMatch(/[А-Яа-яЁё]/)
      expect(uiText('Такая точка уже есть на карте')).toBe('This point is already on the map')
    } finally {
      setRenderLanguage('ru')
    }
    expect(uiText('Добавить точку')).toBe('Добавить точку')
  })

  it('has no duplicate Russian keys with different translations', () => {
    const seen = new Map<string, string>()
    for (const [ru, en] of SUGGEST_POINT_PHRASES) {
      if (seen.has(ru)) expect(seen.get(ru)).toBe(en)
      seen.set(ru, en)
    }
  })
})
