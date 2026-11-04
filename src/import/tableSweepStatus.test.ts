import { describe, expect, it } from 'vitest'
import { tableScanNotice, tableSweepLine, type TableSweepStatus } from './tableSweepStatus'

const name = (id: string) => ({ a: 'Простая задача', b: 'Спецзаказ' } as Record<string, string>)[id] ?? id
const reading = (extra: Partial<Extract<TableSweepStatus, { kind: 'reading' }>> = {}): TableSweepStatus => ({ kind: 'reading', mode: 'pve', read: 41, total: 64, unsettled: 0, ...extra })

describe('what the player is told, in both languages (owner, 04.11.2026)', () => {
  it('how far the read is, and that nothing goes until it ends', () => {
    expect(tableSweepLine(reading(), 'ru', name)).toContain('41 из 64')
    expect(tableSweepLine(reading(), 'ru', name)).toContain('ничего не убирается')
    expect(tableSweepLine(reading(), 'en', name)).toContain('Read 41 of 64')
    expect(tableSweepLine(reading(), 'en', name)).toContain('nothing is removed')
  })

  it('a row not read exactly', () => {
    expect(tableSweepLine(reading({ unsettled: 2 }), 'ru', name)).toContain('Точно не прочитано: 2')
    expect(tableSweepLine(reading({ unsettled: 2 }), 'en', name)).toContain('2 not read exactly')
  })

  it('why a frame did not count', () => {
    for (const [refusal, ru, en] of [['search', 'Поиск', 'Search'], ['tab', 'Побочные', 'Side'], ['view', 'Персонаж', 'Character'], ['mode', 'режим', 'mode']] as const) {
      expect(tableSweepLine(reading({ refusal }), 'ru', name)).toContain(ru)
      expect(tableSweepLine(reading({ refusal }), 'ru', name)).toContain('Ничего не убрано')
      expect(tableSweepLine(reading({ refusal }), 'en', name)).toContain(en)
      expect(tableSweepLine(reading({ refusal }), 'en', name)).toContain('Nothing was removed')
    }
  })

  it('the result names the quests, a long list cut short', () => {
    expect(tableSweepLine({ kind: 'done', mode: 'pve', added: ['a'], gone: ['b'] }, 'ru', name)).toBe('Весь список прочитан. Добавлено: Простая задача. Убрано: Спецзаказ.')
    expect(tableSweepLine({ kind: 'done', mode: 'pve', added: [], gone: [] }, 'ru', name)).toBe('Весь список прочитан. Квесты совпадают с игрой.')
    expect(tableSweepLine({ kind: 'done', mode: 'pve', added: [], gone: [] }, 'en', name)).toBe('The whole list was read. Your quests match the game.')
    expect(tableSweepLine({ kind: 'done', mode: 'pve', added: [], gone: ['1', '2', '3', '4', '5', '6', '7'] }, 'ru', name)).toContain('5 и ещё 2')
  })

  it('the notice while the table is read says the same one thing', () => {
    expect(tableScanNotice('2026-11-04T12:00:00.000Z', 'ru')).toContain('приложение само добавит')
    expect(tableScanNotice('2026-11-04T12:00:00.000Z', 'en')).toContain('the app adds what is missing')
  })
})
