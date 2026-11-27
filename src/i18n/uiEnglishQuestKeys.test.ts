import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TargetLanguage } from './languages'
import { setRenderLanguage, uiText } from './renderText'
import { loadTargetTable } from './targetText'

const TARGETS: TargetLanguage[] = ['de', 'es', 'fr', 'ja', 'ko', 'pl', 'pt', 'tr', 'zh']
/** «Ключи под вопросом» and «Ключи в схроне» without «Изменить ключи в схроне» (owner, 27.11.2026). */
const TEXTS: Array<[string, string]> = [
  ['Ключи под вопросом', 'Keys to confirm'],
  ['Найдены ключи с одинаковыми названиями — выберите правильный ключ.', 'Keys with the same name were found — choose the right key.'],
  ['В схроне пока нет ключей. Нажмите «Найти ключи».', 'No keys in the stash yet. Press «Find keys».'],
  ['Ок', 'OK'], ['Убрать', 'Remove'], ['Есть в схроне', 'In stash'], ['Минус один', 'One less'], ['Плюс один', 'One more'],
]

afterEach(() => setRenderLanguage('ru'))

describe('«Ключи под вопросом» in every language', () => {
  it('Russian as written, English short', () => {
    for (const [ru] of TEXTS) expect(uiText(ru)).toBe(ru)
    setRenderLanguage('en')
    for (const [ru, en] of TEXTS) expect(uiText(ru)).toBe(en)
  })

  it('each of the nine other languages has them; «Изменить ключи в схроне» is gone from them', async () => {
    for (const language of TARGETS) {
      const table = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${language}.json`), 'utf8')) as Record<string, string>
      expect(table['Edit stash keys'], language).toBeUndefined()
      await loadTargetTable(language)
      setRenderLanguage(language)
      for (const [ru, en] of TEXTS) {
        expect(table[en], `${language}: ${en}`).toBeTruthy()
        expect(uiText(ru), `${language}: ${en}`).toBe(table[en])
      }
    }
  })
})
