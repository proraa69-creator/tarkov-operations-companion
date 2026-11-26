import { describe, expect, it } from 'vitest'
import { cjkBlocksText, hasCjk, joinCjkSpaces, joinCjkWords, letterWeight, squeezeCjkSpaces } from './cjk'

const word = (text: string, x0: number, x1: number, y0 = 10, y1 = 30) => ({ text, bbox: { x0, y0, x1, y1 } })

describe('Japanese and Chinese OCR text', () => {
  it('loses the spaces between characters and nothing else', () => {
    expect(joinCjkSpaces('任 意 地 点 进 行 中 ！')).toBe('任意地点进行中！')
    expect(joinCjkSpaces('Prapor 首 秀 海 关')).toBe('Prapor 首秀海关')
    // Russian, English and German text stays as it is.
    expect(joinCjkSpaces('Врачебная тайна. Часть 2  активно!')).toBe('Врачебная тайна. Часть 2  активно!')
    expect(joinCjkSpaces('Geheimhaltung im Gesundheitswesen – Teil 2')).toBe('Geheimhaltung im Gesundheitswesen – Teil 2')
    expect(hasCjk('Jäger')).toBe(false)
  })

  it('weighs a character as two letters', () => {
    expect(letterWeight('審計')).toBe(4)
    expect(letterWeight('审计abc')).toBe(7)
    expect(letterWeight('Аудит')).toBe(5)
  })

  it('makes one word of a run of characters, and keeps the cells of a table apart', () => {
    const line = [word('医疗', 335, 373), word('隐私', 379, 412), word('-', 425, 426), word('2', 435, 445), word('任意', 944, 990), word('地', 990, 1003), word('点', 1009, 1022)]
    expect(joinCjkWords(line).map((entry) => entry.text)).toEqual(['医疗隐私', '-', '2', '任意地点'])
    expect(joinCjkWords(line)[3]!.bbox).toEqual({ x0: 944, y0: 10, x1: 1022, y1: 30 })
    // Two runs a column apart stay two words.
    expect(joinCjkWords([word('海关', 944, 982), word('进行', 1173, 1231)]).map((entry) => entry.text)).toEqual(['海关', '进行'])
    const latin = [word('Prapor', 45, 108), word('Debut', 335, 386)]
    expect(joinCjkWords(latin)).toEqual(latin)
  })

  it('rebuilds a reading\'s text from its word boxes', () => {
    const blocks = [{ paragraphs: [{ lines: [
      { words: [word('Therapist', 43, 130), word('医疗', 335, 373), word('隐私', 379, 412), word('任意', 944, 990), word('地点', 990, 1022)] },
      { words: [word('药剂', 333, 380, 60, 80), word('师', 383, 393, 60, 80)] },
    ] }] }]
    expect(cjkBlocksText(blocks)).toBe('Therapist 医疗隐私 任意地点\n药剂师')
    expect(cjkBlocksText(null)).toBeNull()
  })

  it('squeezes the spaces beside characters for the item names', () => {
    expect(squeezeCjkSpaces('m4a1 アサルトライフル')).toBe('m4a1アサルトライフル')
    expect(squeezeCjkSpaces('salewa 急救包')).toBe('salewa急救包')
    expect(squeezeCjkSpaces('salewa first aid kit')).toBe('salewa first aid kit')
  })
})
