import { describe, expect, it } from 'vitest'
import { exitHighlights, exitKey, isUncertainExit, matchListedExits, parseExtractList } from './raidExtracts'

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

  it('lights the listed exits, dims the others, leaves the train and the car exits alone, only for this raid', () => {
    const exits = RESERVE
    const highlights = exitHighlights({ names: parseExtractList(READ), at: 2000 }, 1000, exits)!
    expect([...highlights.lit].sort()).toEqual(['cliff', 'd2', 'hermetic', 'sewer', 'wild'])
    expect([...highlights.dim]).toEqual(['exit-hole'])
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
    expect([...highlights.lit].sort()).toEqual(['cliff', 'd2', 'hermetic', 'sewer', 'wild'])
    expect([...highlights.dim]).toEqual(['exit-hole'])
  })
})
