import { describe, expect, it } from 'vitest'
import { matchesSearchQuery, searchTerms } from './textSearch'

describe('search by words', () => {
  const sj1 = ['Боевой стимулятор SJ1 TGLabs', 'SJ1']
  const sj12 = ['Боевой стимулятор SJ12 TGLabs', 'SJ12']

  it('finds the SJ1 and SJ12 stimulants the way a player typed them (23.11.2026)', () => {
    expect(matchesSearchQuery('SJ1 боевой стимулятор', ...sj1)).toBe(true)
    expect(matchesSearchQuery('SJ12 боевой стимулятор', ...sj12)).toBe(true)
    expect(matchesSearchQuery('стимулятор SJ12', ...sj12)).toBe(true)
    expect(matchesSearchQuery('sj12 боевой', ...sj1)).toBe(false)
  })

  it('takes a Russian word in another form', () => {
    expect(matchesSearchQuery('инъектор с боевым стимулятором', 'Инъектор с боевым стимулятором')).toBe(true)
    expect(matchesSearchQuery('боевые стимуляторы', ...sj1)).toBe(true)
    expect(matchesSearchQuery('ключи от общаги', 'Ключ от комнаты 314 в общежитии')).toBe(false)
    expect(matchesSearchQuery('ключ общежит', 'Ключ от комнаты 314 в общежитии')).toBe(true)
    expect(matchesSearchQuery('ёлочная игрушка', 'Елочная игрушка')).toBe(true)
  })

  it('still finds whatever the whole query found', () => {
    expect(matchesSearchQuery('5.45x39', '5.45x39мм ПС гс')).toBe(true)
    expect(matchesSearchQuery('m4a1', 'Штурмовая винтовка Colt M4A1 5.56x45')).toBe(true)
    expect(matchesSearchQuery('ПСО-1', 'Прицел ПСО-1 4x24')).toBe(true)
    expect(matchesSearchQuery('(черный)', 'Шлем EXFIL (черный)')).toBe(true)
    expect(matchesSearchQuery('', 'что угодно')).toBe(true)
    expect(matchesSearchQuery('  ', 'что угодно')).toBe(true)
  })

  it('keeps short words, digits and Latin as typed', () => {
    expect(searchTerms('SJ1 боевой стимулятор')).toEqual(['sj1', 'боев', 'стимулятор'])
    expect(searchTerms('ключ АК-74 «Слик»')).toEqual(['ключ', 'ак-74', 'слик'])
  })
})
