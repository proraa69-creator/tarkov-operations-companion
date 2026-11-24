import { describe, expect, it } from 'vitest'
import { extraGameLanguage, gameLanguageFromCode, ocrModel, ocrModelFiles, parseGameIniLanguage, resolveGameLanguage } from './gameLanguage'
import { gameWordPattern, languageWords, umlautForms } from './gameWordPatterns'
import { GAME_WORDS } from './gameWords'

describe('the game language', () => {
  it('is read from the game\'s Game.ini with the game\'s own codes', () => {
    const ini = (language: string) => JSON.stringify({ Version: 1, Language: language, FieldOfView: 66 }, null, 2)
    expect(parseGameIniLanguage(ini('ru'))).toBe('ru')
    expect(parseGameIniLanguage(ini('en'))).toBe('en')
    expect(parseGameIniLanguage(ini('ge'))).toBe('de')
    expect(parseGameIniLanguage(ini('jp'))).toBe('ja')
    expect(parseGameIniLanguage(ini('ch'))).toBe('zh')
    // Any other language of the game is read with the English words and models.
    expect(parseGameIniLanguage(ini('fr'))).toBe('en')
    expect(parseGameIniLanguage(ini('po'))).toBe('en')
  })

  it('survives a byte order mark, a damaged file and a file without the key', () => {
    expect(parseGameIniLanguage(`\uFEFF${JSON.stringify({ Language: 'ge' })}`)).toBe('de')
    expect(parseGameIniLanguage('{ "Version": 1, "Language": "jp", "Broken": ')).toBe('ja')
    expect(parseGameIniLanguage(JSON.stringify({ Version: 1 }))).toBeNull()
    expect(parseGameIniLanguage('')).toBeNull()
    expect(gameLanguageFromCode('  ')).toBeNull()
  })

  it('takes the player\'s choice over the game\'s, and reads as before without either', () => {
    expect(resolveGameLanguage('auto', 'zh')).toBe('zh')
    expect(resolveGameLanguage('de', 'zh')).toBe('de')
    expect(resolveGameLanguage('auto', null)).toBe('ru')
    expect(resolveGameLanguage(undefined, null)).toBe('ru')
  })

  it('reads Russian and English with one engine as before, the others with their model and the English one', () => {
    expect(ocrModel('ru')).toBe('rus+eng')
    expect(ocrModel('en')).toBe('rus+eng')
    expect(ocrModel(null)).toBe('rus+eng')
    expect(ocrModel('de')).toBe('deu+eng')
    expect(ocrModel('ja')).toBe('jpn+eng')
    expect(ocrModel('zh')).toBe('chi_sim+eng')
    expect(ocrModelFiles('chi_sim+eng')).toEqual(['chi_sim', 'eng'])
    expect([extraGameLanguage('ru'), extraGameLanguage('en'), extraGameLanguage('ja')]).toEqual([null, null, 'ja'])
  })
})

describe('the game\'s words', () => {
  it('are taken from the game\'s localisation for every role', () => {
    for (const language of ['de', 'ja', 'zh'] as const) {
      const words = GAME_WORDS[language]
      expect(Object.values(words.status).every(Boolean), language).toBe(true)
      expect(words.anyLocation && words.trader.attitude && words.trader.you && words.exits.exfil && words.exits.transit, language).toBeTruthy()
      expect(words.columns.length, language).toBe(6)
      expect(Object.keys(words.traders), language).toContain('prapor')
      expect(Object.keys(words.maps), language).toContain('customs')
    }
    expect(GAME_WORDS.de.status.active).toBe('Aktiv')
    expect(GAME_WORDS.ja.status.active).toBe('進行中')
    expect(GAME_WORDS.zh.status.active).toBe('进行中！')
    expect(GAME_WORDS.de.part).toBe('Teil')
    expect(GAME_WORDS.zh.maps.customs).toBe('海关')
  })

  it('are none in a Russian or English game', () => {
    expect(languageWords('ru')).toBeNull()
    expect(languageWords('en')).toBeNull()
    expect(languageWords(undefined)).toBeNull()
  })

  it('are looked for as the OCR gives them', () => {
    const active = new RegExp(gameWordPattern('Aktiv'), 'iu')
    expect(active.test('Prapor Debüt Customs AKTIV 0%')).toBe(true)
    // A Latin word stands alone: not inside a longer word.
    expect(active.test('Aktivität')).toBe(false)
    const you = new RegExp(gameWordPattern('(你)'), 'iu')
    expect(you.test('Raid_OS （你）')).toBe(true)
    expect(you.test('Raid_OS ( 你 )')).toBe(true)
    // A Chinese word may touch its neighbours; «！» at its end is optional.
    const zh = new RegExp(gameWordPattern('进行中！'), 'iu')
    expect(zh.test('首秀 海关进行中 0%')).toBe(true)
    expect(zh.test('海关 进行中! 0%')).toBe(true)
  })

  it('keep a German name\'s umlauts in every form the OCR may give', () => {
    expect(umlautForms('Jäger')).toEqual(['Jäger', 'Jager', 'Jaeger'])
    expect(umlautForms('Prapor')).toEqual(['Prapor'])
  })
})
