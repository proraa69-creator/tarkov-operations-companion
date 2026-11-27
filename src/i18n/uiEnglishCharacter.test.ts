import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TargetLanguage } from './languages'
import { setRenderLanguage, uiLabel, uiText } from './renderText'
import { loadTargetTable } from './targetText'

const TARGETS: TargetLanguage[] = ['de', 'es', 'fr', 'ja', 'ko', 'pl', 'pt', 'tr', 'zh']

afterEach(() => setRenderLanguage('ru'))

/** Owner, 27.11.2026: «нижняя граница уровня по квестам и ручной ввод уровня» (components/PlayerLoadoutSummary.tsx). */
describe('the level without a reading, in every language', () => {
  it('Russian as written; English with the number in its phrase', () => {
    expect(uiText('Уровень не ниже 24')).toBe('Уровень не ниже 24')
    setRenderLanguage('en')
    expect(uiText('Уровень не ниже 24')).toBe('At least level 24')
    expect(uiLabel('Указать уровень')).toBe('Set level')
  })

  it('each of the nine other languages has both phrases, the number where the language puts it', async () => {
    for (const language of TARGETS) {
      const table = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${language}.json`), 'utf8')) as Record<string, string>
      expect(table['At least level $1'], language).toContain('$1')
      expect(table['Set level'], language).toBeTruthy()
      await loadTargetTable(language)
      setRenderLanguage(language)
      expect(uiText('Уровень не ниже 24'), language).toBe(table['At least level $1']!.replace('$1', '24'))
      expect(uiLabel('Указать уровень'), language).toBe(table['Set level'])
    }
  })
})
