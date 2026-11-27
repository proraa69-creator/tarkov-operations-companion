import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BACK_BUTTON_PLACES } from '../mobile/backHistory'
import type { TargetLanguage } from './languages'
import { setRenderLanguage, uiText } from './renderText'
import { loadTargetTable } from './targetText'

const TARGETS: TargetLanguage[] = ['de', 'es', 'fr', 'ja', 'ko', 'pl', 'pt', 'tr', 'zh']
const CYRILLIC = /[А-Яа-яЁё]/
/**
 * The phone's own screens: Settings → «Кнопка «Назад»» and its four corners, the quest list of the phone's map. They had no
 * English, so every language showed Russian or a word-by-word mix (owner, 28.11.2026: «кнопки не переведены ни в каком языке»).
 */
const TEXTS: Array<[string, string]> = [
  ['Кнопка «Назад»', '«Back» button'],
  ['Где кнопка «Назад»', 'Where the «Back» button is'],
  ['Есть на каждом экране после перехода по меню и возвращает туда же, где вы были. Нажмите кнопку на картинке — удобно ли до неё дотянуться.', 'Shown on every screen opened from the menu; it takes you back to where you were. Tap the button in the picture to check it is easy to reach.'],
  ['Вверху слева', 'Top left'], ['Вверху справа', 'Top right'], ['Внизу слева', 'Bottom left'], ['Внизу справа', 'Bottom right'],
  ['На этой карте нет текущих квестов.', 'No current quests on this map.'],
  ['Удерживайте квест — коротко цели и требования.', 'Hold a quest for its goals and requirements in brief.'],
]

afterEach(() => setRenderLanguage('ru'))

describe('the phone\'s «Назад» setting and map quest list in every language', () => {
  it('every corner of «Назад» has its English', () => {
    setRenderLanguage('en')
    for (const place of BACK_BUTTON_PLACES) expect(uiText(place.label), place.id).not.toMatch(CYRILLIC)
  })

  it('Russian as written, English whole', () => {
    for (const [ru] of TEXTS) expect(uiText(ru)).toBe(ru)
    setRenderLanguage('en')
    for (const [ru, en] of TEXTS) expect(uiText(ru)).toBe(en)
    expect(uiText('Prapor · любая карта')).toBe('Prapor · any map')
  })

  it('each of the nine other languages has them, with no Russian left', async () => {
    for (const language of TARGETS) {
      const table = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${language}.json`), 'utf8')) as Record<string, string>
      await loadTargetTable(language)
      setRenderLanguage(language)
      for (const [ru, en] of TEXTS) {
        expect(table[en], `${language}: ${en}`).toBeTruthy()
        expect(uiText(ru), `${language}: ${en}`).toBe(table[en])
      }
      expect(uiText('Prapor · любая карта'), language).not.toMatch(CYRILLIC)
    }
  })
})
