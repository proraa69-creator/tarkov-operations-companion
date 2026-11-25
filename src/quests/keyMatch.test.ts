import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { createKeyMatcher, keyDigits } from './keyMatch'

// The app's keys (and the items that share a key's label) as the catalog gave them on 25.11.2026.
const items = JSON.parse(readFileSync(join(__dirname, '__fixtures__/key-items-ru.json'), 'utf8')) as Item[]
const keys = items.filter((item) => item.category === 'Ключ')
const matcher = createKeyMatcher(keys, items)
const read = (text: string) => matcher.line(text).map((id) => keys.find((key) => key.id === id)!.shortName)

// Readings of labels as the scan's OCR wrote them on the frames of src/quests/__fixtures__ (report 236, the offline stash).
describe('the keys a label reading is', () => {
  it('reads the dorm keys of report 236, the slashed zero as 0, @ or Ø', () => {
    expect(read('Общ 110')).toEqual(['Общ 110'])
    expect(read('Общ 103')).toEqual(['Общ 103'])
    expect(read('Общ 11@')).toEqual(['Общ 110'])
    expect(read('Общ 2Ø3')).toEqual(['Общ 203'])
  })

  it('takes no key from a reading the misread digits fit twice («Общ 118» may be «Общ 110»)', () => {
    expect(read('Общ 118')).toEqual([])
    expect(read('Общ 105')).toEqual([])
    expect(read('Общ 164')).toEqual([])
  })

  it('never takes a word or a stretch of a longer reading for a short key («РБ-СТ», «С-3», «Офис»)', () => {
    expect(read('Hoc 33.')).toEqual([])
    expect(read('#&3С офис')).toEqual([])
    expect(read('РБ-ПЕП! х')).toEqual([])
    expect(read('Фин. Kc x')).toEqual([])
    expect(read('РБ-СН')).toEqual([])
  })

  it('takes a label one letter off, its digits whole', () => {
    expect(read('РБ-ПЕП2')).toEqual(['РБ-ПСП2'])
    expect(read('Сэн219 3')).toEqual(['Сан219 З'])
    expect(read('Р5-ГН')).toEqual(['РБ-ГН'])
    expect(read('Сан104 3')).toEqual(['Сан104 З'])
  })

  it('takes a label cut at the cell\'s edge when one key starts so', () => {
    expect(read('Сан321 се')).toEqual(['Сан321 сейф'])
    expect(read('Белуга ди')).toEqual(['Белуга дир.'])
    expect(read('Сан2')).toEqual([])
  })

  it('takes both labels of two cells read as one line', () => {
    expect(read('Туалет Мастерск.')).toEqual(['Туалет', 'Мастерск.'])
  })

  it('takes no key from a label other keys or items carry too, only from the tooltip\'s name', () => {
    expect(read('Сейф')).toEqual([])
    expect(read('Авто')).toEqual([])
    expect(read('Завод')).toEqual([])
    expect(read('Ключ от выхода с Завода')).toEqual(['Завод'])
    expect(read('Ключ от комнаты 303 общежития')).toEqual(['Общ 303'])
  })

  it('takes nothing from the game\'s captions or a counter', () => {
    expect(read('ЗАДАНИЯ')).toEqual([])
    expect(read('40/40')).toEqual([])
  })

  it('counts the digits of a label, not the letters a misread put there', () => {
    expect(keyDigits('Сан104 З')).toBe('104')
    expect(keyDigits('Общ 11O')).toBe('110')
    expect(keyDigits('Сэн219 3')).toBe('219')
    expect(keyDigits('ЗБ-014')).toBe('014')
  })
})
