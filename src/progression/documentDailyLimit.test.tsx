import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DocumentDayLine } from '../components/BattlePassDocuments'
import { clearDocumentDays, countDocumentFound, DOCUMENT_DAILY_LIMIT, DOCUMENT_DAY_MS, documentDayText, readDocumentDay } from './documentDailyLimit'

afterEach(() => { clearDocumentDays() })

// Report №194 (owner, 19.11.2026): «сколько нажали «Нашел», такой будет лимит… 1 из 40… когда будет найдено 40 документов, он пишет,
// что дневной лимит документов исчерпан».
describe('the daily limit of battle pass documents', () => {
  it('counts each «Нашёл», all modes of the profile together, the first one starting the day', () => {
    const start = Date.UTC(2026, 10, 19, 10)
    expect(readDocumentDay('p1', start)).toEqual({ count: 0, since: 0 })
    countDocumentFound('p1', start)
    countDocumentFound('p1', start + 60_000)
    expect(readDocumentDay('p1', start + 120_000)).toEqual({ count: 2, since: start })
    expect(readDocumentDay('p2', start)).toEqual({ count: 0, since: 0 })
  })

  it('starts again 24 hours after the day\'s first document', () => {
    const start = Date.UTC(2026, 10, 19, 10)
    countDocumentFound('p1', start)
    countDocumentFound('p1', start + 23 * 3_600_000)
    expect(readDocumentDay('p1', start + DOCUMENT_DAY_MS - 1).count).toBe(2)
    expect(readDocumentDay('p1', start + DOCUMENT_DAY_MS).count).toBe(0)
    expect(countDocumentFound('p1', start + DOCUMENT_DAY_MS + 5)).toEqual({ count: 1, since: start + DOCUMENT_DAY_MS + 5 })
  })

  it('has the limit of the mode played: Season 40, PvP 25, PvE 15', () => {
    expect(DOCUMENT_DAILY_LIMIT).toEqual({ seasonal: 40, pvp: 25, pve: 15 })
    expect(documentDayText(10, 'seasonal')).toBe('10/40')
    expect(documentDayText(40, 'seasonal')).toBe('Дневной лимит документов исчерпан')
    expect(documentDayText(15, 'pve')).toBe('Дневной лимит документов исчерпан')
  })

  it('shows «Найдено сегодня: 10/40», and at the limit that it is used up', () => {
    const { rerender } = render(<DocumentDayLine count={10} limit={40} />)
    expect(screen.getByRole('status').textContent).toBe('Найдено сегодня: 10/40')
    rerender(<DocumentDayLine count={40} limit={40} />)
    expect(screen.getByRole('status').textContent).toBe('Дневной лимит документов исчерпан')
  })
})
