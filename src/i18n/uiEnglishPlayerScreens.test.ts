import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TargetLanguage } from './languages'
import { setRenderLanguage, uiText } from './renderText'
import { loadTargetTable } from './targetText'
import { PLAYER_SCREEN_PHRASES, PLAYER_SCREEN_WORDS } from './uiEnglishPlayerScreens'

const TARGETS: TargetLanguage[] = ['de', 'es', 'fr', 'ja', 'ko', 'pl', 'pt', 'tr', 'zh']
const CYRILLIC = /[А-Яа-яЁё]/
const table = (language: TargetLanguage) => JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${language}.json`), 'utf8')) as Record<string, string>

/**
 * The players' screens that had no English (owner, 28.11.2026, from the phone: Russian or a word-by-word mix in every
 * language): «Что собрать для убежища», «Синхронизация по фото», the subscription's reminder, the screens of a start that
 * failed, «Падение пули», the Collector's scan, a theme and a mask… Texts with numbers and names, as the screens build them.
 */
const BUILT: Array<[string, string, string]> = [
  // [Russian as the screen builds it, its English, the template the nine other languages have]
  ['Осталось 3 дня. Доступ действует до 11.12.2026. Продлите подписку, чтобы приложение продолжило работать без перерыва.', '3 days left. Access lasts until 11.12.2026. Renew the subscription to keep the app working without a break.', 'Access lasts until $1. Renew the subscription to keep the app working without a break.'],
  ['Найдено предметов: 4. Добавлено новых: 2.', 'Items found: 4. Newly added: 2.', 'Items found: $1. Newly added: $2.'],
  ['драйвер 32.0.15.6094 от 03.10.2026', 'driver 32.0.15.6094 dated 03.10.2026', 'driver $1 dated $2'],
  ['Не больше 6 скриншотов.', 'At most 6 screenshots.', 'At most $1 screenshots.'],
  ['Не удалось войти: 502', 'Could not sign in: 502', 'Could not sign in: $1'],
  ['Ветка торговца: уровень 3', 'Trader line: level 3', 'Trader line$1: level $2'],
]

afterEach(() => setRenderLanguage('ru'))

describe('the players\' screens in every language', () => {
  it('Russian as written, English whole', () => {
    for (const [ru] of [...PLAYER_SCREEN_PHRASES, ...PLAYER_SCREEN_WORDS]) expect(uiText(ru)).toBe(ru)
    setRenderLanguage('en')
    for (const [ru, en] of [...PLAYER_SCREEN_PHRASES, ...PLAYER_SCREEN_WORDS]) expect(uiText(ru), ru).toBe(en)
    for (const [ru, en] of BUILT) expect(uiText(ru), ru).toBe(en)
  })

  it('a template with « · » or «, » in it is translated whole, a label with its spaces keeps them', () => {
    setRenderLanguage('en')
    // cut at the comma or the dot, no piece matched: «Done. Keys found: 5, новых: 2.»
    expect(uiText('Готово. Найдено ключей: 5, новых: 2.')).toBe('Done. Keys found: 5, new: 2.')
    expect(uiText('Прочитано подписей: 40 · Найдено ключей: 3. Листайте контейнер — поиск идёт.')).toBe('Labels read: 40 · Keys found: 3. Scroll the container — the search goes on.')
    // a label of the game's screen in «» stays as it is
    expect(uiText('Готово. Найдено ключей: 5, новых: 2. Наведите курсор на «Времянка», «Склад»: такая подпись у нескольких ключей. Затем нажмите «Найти ключи» ещё раз.'))
      .toBe('Done. Keys found: 5, new: 2. Hover «Времянка», «Склад»: several keys carry this label. Then press «Find keys» again.')
    expect(uiText('Купить · ')).toBe('Buy · ')
    expect(uiText('Схрон · ')).toBe('Stash · ')
    expect(uiText('Вероятно выполнено: его требует задание из логов.')).toBe('Probably done: a task from the logs needs it.')
  })

  it('a short word of one screen never replaces part of another text', () => {
    setRenderLanguage('en')
    expect(uiText('от')).toBe('from')
    expect(uiText('Время, с')).toBe('Time, s')
    // «Время» elsewhere keeps its own English, «от» and «см» inside a sentence are not touched
    expect(uiText('Время')).toBe('Duration')
    expect(uiText('Отойдите от стены на 30 см')).toMatch(/от .*см/)
  })

  it('each of the nine other languages has them, with no Russian left', async () => {
    for (const language of TARGETS) {
      const own = table(language)
      await loadTargetTable(language)
      setRenderLanguage(language)
      for (const [ru, en] of [...PLAYER_SCREEN_PHRASES, ...PLAYER_SCREEN_WORDS]) {
        expect(own[en], `${language}: ${en}`).toBeTruthy()
        expect(own[en], `${language}: ${en}`).not.toMatch(CYRILLIC)
        expect(uiText(ru), `${language}: ${en}`).toBe(own[en])
      }
      for (const [ru, , template] of BUILT) {
        expect(own[template], `${language}: ${template}`).toBeTruthy()
        expect(uiText(ru), `${language}: ${ru}`).not.toMatch(CYRILLIC)
      }
      expect(uiText('Купить · '), language).toMatch(/ · $/)
    }
  })

  it('«Hideout» is the hideout, not the location «Hideout Under the Landing Stage»', () => {
    for (const language of TARGETS) {
      const own = table(language)
      expect(own.Hideout, language).toBeTruthy()
      expect(own.Hideout, language).not.toBe(own['Hideout Under the Landing Stage'])
      expect(own.Hideout, language).not.toBe('Hideout under the landing stage')
    }
  })
})
