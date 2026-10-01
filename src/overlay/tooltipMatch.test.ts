import { describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { createTooltipMatcher, foldName, looseDigits, repairOcrNumbers, type ItemNameVariant } from './tooltipMatch'

const item = (id: string, name: string, shortName: string) => ({ id, name, shortName }) as unknown as Item

const ITEMS = [
  item('alenka', 'Шоколад "Аленка"', 'Аленка'),
  item('medkit', 'Набор медикаментов', 'Мед.'),
  item('piranha', 'Патрон 12/70 "Пиранья"', 'Пиранья'),
  item('flechette', 'Патрон 12/70 "Флешетта"', 'Флешетта'),
  item('sv98-10', 'Магазин на 10 патронов 7.62x54R для СВ-98', 'СВ-98'),
  item('mosin-10', 'Магазин на 10 патронов 7.62x54R для винтовки Мосина', 'Мосин'),
  item('m14-20', 'Магазин на 20 патронов 7.62x51 для M14', 'M14'),
  item('akm-10', 'Магазин алюминиевый на 10 патронов 7.62x39 для АК', 'AK al.'),
  item('akm-30', 'Магазин алюминиевый на 30 патронов 7.62x39 для АК', 'AK al.'),
  item('pm-pistol', 'Пистолет Макарова ПМ 9x18ПМ', 'ПМ'),
  item('pm-mag', 'Магазин "90-93" на 8 патронов 9x18ПМ для Пистолета Макарова', 'ПМ'),
  item('dorm-220', 'Ключ от комнаты 220 общежития', 'Общ 220'),
  item('dorm-228', 'Ключ от комнаты 228 общежития', 'Общ 228'),
  item('bp-545', 'Пачка патронов 5.45x39мм БП гж (30 штук)', 'БП'),
  item('bp-556', 'Пачка патронов 5.56x45мм M855 (30 штук)', 'M855'),
  item('aks74un', 'Автомат Калашникова АКС-74УН 5.45x39', 'АКС-74УН'),
  item('aks74u', 'Автомат Калашникова АКС-74У 5.45x39', 'АКС-74У'),
  item('ledx', 'Трансиллюминатор кожи LEDX', 'LEDX'),
]
const ENGLISH = new Map<string, ItemNameVariant[]>([
  ['sv98-10', [{ name: 'SV-98 7.62x54R 10-round magazine', shortName: 'SV-98' }]],
  ['m14-20', [{ name: 'M14 7.62x51 20-round magazine', shortName: 'M14' }]],
  ['ledx', [{ name: 'LEDX Skin Transilluminator', shortName: 'LEDX' }]],
  ['aks74un', [{ name: 'Kalashnikov AKS-74UN 5.45x39 assault rifle', shortName: 'AKS-74UN' }]],
])

describe('item from the game tooltip', () => {
  const match = createTooltipMatcher(ITEMS, ENGLISH)

  it('matches the whole name the tooltip shows, despite OCR slips', () => {
    expect(match('Шоколад "Аленка"')?.id).toBe('alenka')
    expect(match('Шоколaд «Алeнкa»')?.id).toBe('alenka')
    expect(match('Патрон 12/70 Пиранья')?.id).toBe('piranha')
    expect(match('| Набор медикаментов')?.id).toBe('medkit')
    expect(match('Трансиллюминатор кожи LEDХ')?.id).toBe('ledx')
  })

  it('reads English tooltips too (the game language need not be the app language)', () => {
    expect(match('SV-98 7.62x54R 10-round magazine')?.id).toBe('sv98-10')
    expect(match('LEDX Skin Transiluminator')?.id).toBe('ledx')
    expect(match('Kalashnikov AKS-74UN 5.45x39 assault rifle')?.id).toBe('aks74un')
  })

  it('never takes one magazine for another: the numbers must agree', () => {
    expect(match('Магазин на 10 патронов 7.62x54R для СВ-98')?.id).toBe('sv98-10')
    // A 10-round magazine is not the 20-round one, even with the rest of the line garbled.
    expect(match('Магазин на 10 патронов 7.62x51 для M14')).toBeNull()
    expect(match('Магазин алюминиевый на 10 патронов 7.62x39 для АК')?.id).toBe('akm-10')
    expect(match('Магазин алюминиевый на 30 патронов 7.62x39 для АК')?.id).toBe('akm-30')
    expect(match('Пачка патронов 5.45x39мм БП гж (30 штук)')?.id).toBe('bp-545')
  })

  it('forgives the digit slips of the game font but not a guess between twins', () => {
    // Square 0 read as 8/@, flat 3 as 5, dropped decimal point.
    expect(match('Магазин на 1@ патронов 762x54R для СВ-98')?.id).toBe('sv98-10')
    expect(match('Автомат Калашникова АКС-74УН 5.45х59')?.id).toBe('aks74un')
    // Room 220 and room 228 differ only in digits the OCR mixes up: no answer rather than maybe the wrong key.
    expect(match('Ключ от комнаты 228 общежития')).toBeNull()
    expect(match('Ключ от комнаты 220 общежития')?.id).toBe('dorm-220')
  })

  it('accepts a short name only whole and only when it names one item', () => {
    expect(match('Пиранья')?.id).toBe('piranha')
    expect(match('LEDX')?.id).toBe('ledx')
    // "ПМ" is the pistol and its magazine; "AK al." two magazines.
    expect(match('ПМ')).toBeNull()
    expect(match('AK al.')).toBeNull()
  })

  it('answers nothing rather than a wrong item', () => {
    expect(match('Рюкзак')).toBeNull()
    expect(match('Патрон')).toBeNull()
    expect(match('')).toBeNull()
    // One letter apart from two items: АКС-74У or АКС-74УН.
    expect(match('Автомат Калашникова АКС-74УМ 5.45x39')).toBeNull()
  })
})

describe('OCR text folding', () => {
  it('repairs look-alike letters inside numbers only', () => {
    expect(repairOcrNumbers('на 1О патронов')).toBe('на 10 патронов')
    expect(repairOcrNumbers('2o-round')).toBe('20-round')
    expect(repairOcrNumbers('Бронежилет 6Б43')).toBe('Бронежилет 6Б43')
    expect(repairOcrNumbers('M4A1')).toBe('M4A1')
  })

  it('folds Cyrillic and Latin look-alikes and keeps decimal points', () => {
    expect(foldName('Пачка 5,45х39мм')).toBe(foldName('Пaчкa 5.45x39мм'))
    expect(foldName('0.6л')).toContain('0.6')
  })

  it('merges digits the game font makes look alike, on both sides the same way', () => {
    expect(looseDigits(foldName('SAS8 M-LOK'))).toBe(looseDigits(foldName('SA58 M-LOK')))
    expect(looseDigits(foldName('Бронежилет 662'))).toBe(looseDigits(foldName('Бронежилет 6Б2')))
    expect(looseDigits('10')).not.toBe(looseDigits('20'))
  })
})
