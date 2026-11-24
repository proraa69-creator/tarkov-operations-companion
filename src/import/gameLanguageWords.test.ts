import { describe, expect, it } from 'vitest'
import { EXTRA_GAME_LANGUAGES, GAME_LANGUAGES, extraGameLanguage, ocrModel, ocrModelFiles, OCR_MODEL_FILES, resolveGameLanguage } from './gameLanguage'
import { anyGameWord, gameWordPattern, languageWords, umlautForms } from './gameWordPatterns'
import { GAME_WORDS } from './gameWords'

describe('the game language', () => {
  it('is the player\'s choice, English by default; nothing is read from the game (owner, 24.11.2026)', () => {
    expect(resolveGameLanguage('de')).toBe('de')
    expect(resolveGameLanguage('zh')).toBe('zh')
    expect(resolveGameLanguage('ru')).toBe('ru')
    expect(resolveGameLanguage('ko')).toBe('ko')
    expect(resolveGameLanguage(undefined)).toBe('en')
    // A setting from before («auto», when the game's file was read) or anything else: English.
    expect(resolveGameLanguage('auto')).toBe('en')
    expect(resolveGameLanguage('uk')).toBe('en')
    expect(resolveGameLanguage('es-mx')).toBe('en')
  })

  it('lists the game\'s eleven languages, English first', () => {
    expect(GAME_LANGUAGES).toEqual(['en', 'ru', 'de', 'ja', 'zh', 'pl', 'es', 'pt', 'fr', 'ko', 'tr'])
    expect(EXTRA_GAME_LANGUAGES).toEqual(GAME_LANGUAGES.filter((language) => language !== 'en' && language !== 'ru'))
  })

  it('reads Russian and English with one engine as before, the others with their model and the English one', () => {
    expect(ocrModel('ru')).toBe('rus+eng')
    expect(ocrModel('en')).toBe('rus+eng')
    expect(ocrModel(null)).toBe('rus+eng')
    expect(ocrModel('de')).toBe('deu+eng')
    expect(ocrModel('ja')).toBe('jpn+eng')
    expect(ocrModel('zh')).toBe('chi_sim+eng')
    expect(ocrModel('pl')).toBe('pol+eng')
    expect(ocrModel('es')).toBe('spa+eng')
    expect(ocrModel('pt')).toBe('por+eng')
    expect(ocrModel('fr')).toBe('fra+eng')
    expect(ocrModel('ko')).toBe('kor+eng')
    expect(ocrModel('tr')).toBe('tur+eng')
    expect(ocrModelFiles('chi_sim+eng')).toEqual(['chi_sim', 'eng'])
    // Every model a language needs is shipped.
    for (const language of GAME_LANGUAGES) for (const file of ocrModelFiles(ocrModel(language))) expect(OCR_MODEL_FILES, language).toContain(file)
    expect([extraGameLanguage('ru'), extraGameLanguage('en'), extraGameLanguage('ja'), extraGameLanguage('tr'), extraGameLanguage('uk')]).toEqual([null, null, 'ja', 'tr', null])
  })
})

describe('the game\'s words', () => {
  it('are taken from the game\'s localisation for every role, in every language', () => {
    for (const language of EXTRA_GAME_LANGUAGES) {
      const words = GAME_WORDS[language]
      expect(Object.values(words.status).every((list) => list.length > 0), language).toBe(true)
      for (const list of [words.anyLocation, words.trader.attitude, words.trader.you, words.exits.exfil, words.exits.transit, words.flea.condition]) expect(list.length, language).toBeGreaterThan(0)
      expect(words.columns.length, language).toBe(6)
      expect(Object.keys(words.traders), language).toContain('prapor')
      expect(Object.keys(words.maps), language).toContain('customs')
    }
    expect(GAME_WORDS.de.status.active).toEqual(['Aktiv'])
    expect(GAME_WORDS.ja.status.active).toEqual(['進行中'])
    expect(GAME_WORDS.zh.status.active).toEqual(['进行中！'])
    expect(GAME_WORDS.pl.status.active).toEqual(['aktywne!'])
    expect(GAME_WORDS.ko.trader.you).toEqual(['(내 정보)'])
    expect(GAME_WORDS.tr.exits.exfil).toEqual(['TAHLİYE'])
    expect(GAME_WORDS.de.part).toEqual(['Teil'])
    expect(GAME_WORDS.pl.part).toEqual(['część'])
    expect(GAME_WORDS.tr.part).toEqual(['Bölüm'])
    expect(GAME_WORDS.zh.maps.customs).toContain('海关')
    expect(GAME_WORDS.ko.traders.prapor).toContain('프라퍼')
    // The locale files' names beside tarkov.dev's: the Turkish game's portraits say «Terapist», «Simsar».
    expect(GAME_WORDS.tr.traders.therapist).toEqual(expect.arrayContaining(['Therapist', 'Terapist']))
    expect(GAME_WORDS.tr.traders.fence).toContain('Simsar')
  })

  it('keep both of the game\'s Spanish wordings («Español» and «Español Latinoamérica») where they differ', () => {
    expect(GAME_WORDS.es.status.ready).toEqual(['¡Finalizada!', '¡Terminada!'])
    expect(GAME_WORDS.es.status.failed).toEqual(['Fallada', 'Fallida'])
    expect(GAME_WORDS.es.exits.exfil).toEqual(['EXT.', 'EXFIL'])
    expect(GAME_WORDS.es.columns[0]).toEqual(['Vendedor', 'Comerciante'])
    expect(GAME_WORDS.es.status.active).toEqual(['¡Activa!'])
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

  it('with their accents read or lost, the Turkish i in every form, the Spanish «¡» optional', () => {
    const verrouille = new RegExp(gameWordPattern('Verrouillé'), 'iu')
    expect(['Verrouillé', 'VERROUILLÉ', 'Verrouille'].map((text) => verrouille.test(text))).toEqual([true, true, true])
    const czesc = new RegExp(gameWordPattern('część'), 'iu')
    expect(['część', 'CZĘŚĆ', 'czesc'].map((text) => czesc.test(text))).toEqual([true, true, true])
    const tahliye = new RegExp(gameWordPattern('TAHLİYE'), 'iu')
    expect(['TAHLİYE01', 'TAHLIYE01', 'tahliye', 'tahlıye', 'TAHLİYE'.toLowerCase(), 'TAHLİYELER'].map((text) => tahliye.test(text))).toEqual([true, true, true, true, true, false])
    const activa = new RegExp(anyGameWord(['¡Activa!']), 'iu')
    expect(['¡Activa!', 'Activa!', 'iActiva!', '|Activa', 'Inactiva'].map((text) => activa.test(text))).toEqual([true, true, true, true, false])
    // Korean: a word of its own («완료» is not the start of «완료함»).
    const done = new RegExp(gameWordPattern('완료!'), 'iu')
    expect(['완료!', '완료', '완료함'].map((text) => done.test(text))).toEqual([true, true, false])
  })

  it('keep a German name\'s umlauts in every form the OCR may give', () => {
    expect(umlautForms('Jäger')).toEqual(['Jäger', 'Jager', 'Jaeger'])
    expect(umlautForms('Prapor')).toEqual(['Prapor'])
  })
})
