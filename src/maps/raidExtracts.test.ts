import { describe, expect, it } from 'vitest'
import { exitHighlights, exitKey, isStayReading, isUncertainExit, matchListedExits, parseExtractList } from './raidExtracts'

// Report №105 (Reserve, the player's screenshot) as the OCR gives it, a slip or two included.
const READ = `Найдите зону выхода 0:39:54
ВЫХОД01 Бронепоезд ??:??:??
ВЫХОД02 Д-2
ВЫХОДО3 Гермозатвор бункера
ВЫХОД04 Спуск со скалы
BЫXOД05 Дикие места (Совм.)
ВЫХОД06 Канализационный люк
ПЕРЕХОД01 Переход на Таможню 0:00:54
ПЕРЕХОД02 Переход на Лес 0:00:54
ПЕРЕХОД03 Переход на Маяк 0:00:54`

const RESERVE = [
  { id: 'train', title: 'Бронепоезд', titles: ['Бронепоезд', 'Armored Train'] },
  { id: 'd2', title: 'Д-2', titles: ['Д-2', 'D-2'] },
  { id: 'hermetic', title: 'Гермозатвор бункера', titles: ['Гермозатвор бункера', 'Bunker Hermetic Door'] },
  { id: 'cliff', title: 'Спуск со скалы', titles: ['Спуск со скалы', 'Cliff Descent'] },
  { id: 'wild', title: 'Дикие места', titles: ['Дикие места', 'Scav Lands'] },
  { id: 'sewer', title: 'Канализационный люк', titles: ['Канализационный люк', 'Sewer Manhole'] },
  { id: 'exit-hole', title: 'Дыра в заборе', titles: ['Дыра в заборе', 'Hole in the Fence'] },
  { id: 'vex', title: 'А-Выход на мосту', titles: ['А-Выход на мосту', 'Bridge V-Ex'] },
]

describe('the exits the game lists after a double O (report №105)', () => {
  it('reads the exit lines and leaves the header and the transits out', () => {
    expect(parseExtractList(READ)).toEqual(['Бронепоезд', 'Д-2', 'Гермозатвор бункера', 'Спуск со скалы', 'Дикие места (Совм.)', 'Канализационный люк'])
  })

  it('reads the English list too', () => {
    expect(parseExtractList('EXFIL01 Scav Lands (Co-op) 0:12:00\nEXFIL02 Sewer Manhole\nTRANSIT01 Transit to Woods 0:00:54')).toEqual(['Scav Lands (Co-op)', 'Sewer Manhole'])
  })

  it('matches the names with the map\'s exits, a letter slipped or not', () => {
    const listed = matchListedExits(['Д-2', 'Гермозатвор бункеpа', 'Спуск со скалы', 'Дикие места (Совм.)', 'Канализацнонный люк'], RESERVE)
    expect([...listed].sort()).toEqual(['cliff', 'd2', 'hermetic', 'sewer', 'wild'])
    expect(matchListedExits(['Д-3'], RESERVE).size).toBe(0)
  })

  it('lights the listed exits, dims the others — the train and the car too, by the list (owner, 11.11.2026) — only for this raid', () => {
    const exits = RESERVE
    const highlights = exitHighlights({ names: parseExtractList(READ), at: 2000 }, 1000, exits)!
    expect([...highlights.lit].sort()).toEqual(['cliff', 'd2', 'hermetic', 'sewer', 'train', 'wild'])
    expect([...highlights.dim].sort()).toEqual(['exit-hole', 'vex'])
    expect(exitHighlights({ names: ['Д-2'], at: 500 }, 1000, exits)).toBeNull()
    expect(exitHighlights(null, 1000, exits)).toBeNull()
  })

  it('knows the exits with no fixed time or a price', () => {
    expect(isUncertainExit('Бронепоезд')).toBe(true)
    expect(isUncertainExit('Dorms V-Ex')).toBe(true)
    expect(isUncertainExit('Д-2')).toBe(false)
    expect(exitKey('Дикие места (Совм.)')).toBe('дикиеместа')
  })

  // The report's own screenshot through the app's reading (electron/extractsReader.ts, tesseract rus+eng), slips and all.
  it('matches what the OCR really read from the report\'s screenshot', () => {
    const ocr = 'ВЫХОДЕ! Брочепоезд 22:72:27?\nBbIXO4@2 1-2\n\nВЫХОДВЗ гермозатвор бункера\n\nВЫХОДВ4 Сгуск со скаль\n\nВЫХОДО5 Дикие места (Совм)\n\nВЫХОДОб канализационный люк\n\nNEPEXOQ@1 Пепэхол на Таможню 0:00:54\nNEPEXOQ@2 Пеэрехсд на Fer 0:00:54\nNEPEXOQ@3 переход на Маяк 0:00:54'
    const names = parseExtractList(ocr)
    expect(names).toEqual(['Брочепоезд', '1-2', 'гермозатвор бункера', 'Сгуск со скаль', 'Дикие места (Совм)', 'канализационный люк'])
    const highlights = exitHighlights({ names, at: 2000 }, 1000, RESERVE)!
    expect([...highlights.lit].sort()).toEqual(['cliff', 'd2', 'hermetic', 'sewer', 'train', 'wild'])
    expect([...highlights.dim].sort()).toEqual(['exit-hole', 'vex'])
  })
})

/** The map's exits as the map page hands them over: a PMC's and a Scav's exit of one name, the transits too. */
const exitsOf = (rows: Array<[string, string]>) => rows.map(([id, title]) => ({ id, title, titles: [title] }))
const lines = (...rows: string[]) => rows.join('\n')

// The owner's own screenshots (11.11.2026, 3440x1440, Documents\Escape from Tarkov\Screenshots) through the new corner
// (electron/extractsReader.ts CORNER, read at twice its size) and tesseract rus+eng: what the OCR really gave.
describe('the exit list of real raids (owner, 11.11.2026: «Мы делали эту функцию до этого, но она не работала»)', () => {
  it('Customs: «ЗБ» read as «35» — every listed exit lit, a Scav exit of the same name too', () => {
    const ocr = lines('ВЫХОДОВ! А-Выход у общаги 22:22:27?', 'ВЫХОДВ2 35-1213', 'ВЫХОДВЗ 35-1911', 'ВЫХОДВ4 старая заправка 22.22.22?', 'ВЫХОДОЪ ЖД кРезерву',
      'ВЫХОДОБ Проход через ЖД пути (Сигнал)', 'ВЫХОДО7 Подвал котельной (Совм)', 'ПЕРЕХОДОВ] Переход на Резерв 0:00:58', 'ПЕРЕХОДО2 Nepexog на Завод 0:00:58')
    const exits = exitsOf([['vex', 'А-Выход у общаги'], ['zb1013', 'ЗБ-1013'], ['zb1011', 'ЗБ-1011'], ['zb1011-scav', 'ЗБ-1011'], ['gas', 'Старая заправка'], ['gas-scav', 'Старая заправка'],
      ['rr', 'ЖД к Резерву'], ['tracks', 'Проход через ЖД пути (Сигнал)'], ['boiler', 'Подвал котельной (Совм.)'], ['crossroads', 'Перекресток'], ['trailer', 'Трейлерный парк'],
      ['boat', 'Лодка Контрабандистов'], ['transit', 'Переход на карту Резерв']])
    const highlights = exitHighlights({ names: parseExtractList(ocr), at: 2000 }, 1000, exits)!
    expect([...highlights.lit].sort()).toEqual(['boiler', 'gas', 'gas-scav', 'rr', 'tracks', 'vex', 'zb1011', 'zb1011-scav', 'zb1013'])
    expect([...highlights.dim].sort()).toEqual(['boat', 'crossroads', 'trailer'])
  })

  it('Interchange: a letter or a mark of the trees before every line', () => {
    const ocr = lines('“4s Найдите зону выхода 0:59:51 —', 'Se ВЫХОДА! Лагерь Диких (Совм) Е', '7 ВЫХОД@2 Безопасная комната', '‘. BbIXOM@3 кпп мчс', 'К ВЫХОД@4 А-Выход у ТЭЦ + 22:22:27',
      '27 ВЫХОДОБ Тропа к реке (Сигнал) |', '„Я ПЕРЕХОДА! Переход на Таможню 0:00:52')
    expect(parseExtractList(ocr)).toEqual(['Лагерь Диких (Совм)', 'Безопасная комната', 'кпп мчс', 'А-Выход у ТЭЦ', 'Тропа к реке (Сигнал)'])
    const exits = exitsOf([['camp', 'Лагерь Диких (Совм.)'], ['safe', 'Безопасная комната'], ['emercom', 'КПП МЧС'], ['emercom-scav', 'КПП МЧС'], ['pp', 'А-Выход у ТЭЦ'],
      ['river', 'Тропа к реке (Сигнал)'], ['rail', 'Выход на железной дороге'], ['hole', 'Дыра в заборе'], ['to-customs', 'Переход на карту Таможня']])
    const highlights = exitHighlights({ names: parseExtractList(ocr), at: 2000 }, 1000, exits)!
    expect([...highlights.lit].sort()).toEqual(['camp', 'emercom', 'emercom-scav', 'pp', 'river', 'safe'])
    expect([...highlights.dim].sort()).toEqual(['hole', 'rail'])
  })

  it('Factory, Labs and Streets', () => {
    const read = (ocr: string, exits: ReturnType<typeof exitsOf>) => [...exitHighlights({ names: parseExtractList(ocr), at: 2000 }, 1000, exits)!.lit].sort()
    const factory = exitsOf([['cellars', 'Подвалы'], ['g3', 'Ворота 3'], ['g0', 'Ворота 0'], ['med', 'Ворота у медицинской палатки'], ['yard', 'Ворота во дворе'], ['office', 'Офисное окно'], ['smugglers', 'Проход Контрабандистов']])
    expect(read(lines('ВЫХОД! Подвалы', 'ВЫХОДВ2 ворота 3', 'ВЫХОДАВЗ Ворота @', 'ВЫХОД@В4 Ворота у медицинской палатки', 'ВЫХОДО5 ворота во дворе', 'ПЕРЕХОДО! Перехсд на Лес 0:00:52'), factory))
      .toEqual(['cellars', 'g0', 'g3', 'med', 'yard'])
    const labs = exitsOf([['hangar', 'Ангар'], ['med', 'Лифт медблока'], ['cargo', 'Грузовой лифт'], ['main', 'Центральный лифт'], ['vent', 'Вентиляционная шахта'], ['parking', 'Парковка'], ['sewage', 'Накопительный коллектор']])
    expect(read(lines('ВЫХОДА! Лифт медблока', 'ВЫХОДВ2 грузовой лифт', 'ВЫХОДВЗ Центральный лифт', 'BbIXOJ@5 накопительный коллектор', 'ВЫХОДОБ Парковка 22:72:77'), labs))
      .toEqual(['cargo', 'main', 'med', 'parking', 'sewage'])
    const streets = exitsOf([['well', 'Двор-колодец'], ['taxi', 'А-выход Такси на Приморском'], ['crash', 'Место крушения'], ['ruined', 'Разрушенный дом'], ['klimov', 'Улица Климова (Сигнал)'], ['pinewood', 'Подвал в Pinewood (Совм.)'], ['crane', 'Упавший кран']])
    expect(read(lines('ВЫХОДОВ! Двор-колодец 22:??:??', 'ВЫХОДО@2 А-выход Такси на Приморском 2:22:27', 'BbIXO{Q@3 Место крушения', 'ВЫХОДА Разрушенный дом', 'ВЫХОДО5 Улица Климова (Сигнал)', 'ВЫХОДОБ Подвал в Pinewood (Совм.'), streets))
      .toEqual(['crash', 'klimov', 'pinewood', 'ruined', 'taxi', 'well'])
  })

  it('«Оставайтесь в зоне выхода» lists one exit: no reading; a list of transits only gives no names', () => {
    expect(isStayReading(lines('«», Оставайтесь в зоне выхода 0:07:21 ss', 'ВЫХОДО5 жд кРезерву 0:00:00'))).toBe(true)
    expect(parseExtractList(lines('сы Найдите зону выхода 0:20:08', '= ПЕРЕХОД@2 переход на Завод'))).toEqual([])
  })

  it('no game logs: a reading counts for 50 minutes', () => {
    const exits = exitsOf([['a', 'Подвалы'], ['b', 'Ворота 3'], ['c', 'Офисное окно']])
    const reading = { names: ['Подвалы', 'Ворота 3'], at: 1_000_000 }
    expect(exitHighlights(reading, undefined, exits, 1_000_000 + 49 * 60_000)?.dim).toEqual(new Set(['c']))
    expect(exitHighlights(reading, undefined, exits, 1_000_000 + 51 * 60_000)).toBeNull()
  })
})
