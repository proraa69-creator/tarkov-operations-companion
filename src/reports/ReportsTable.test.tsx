import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportsTable, type ReportPage, type ReportRow } from './ReportsTable'

const row = (extra: Partial<ReportRow> = {}): ReportRow => ({
  id: 100, kind: 'bug', topic: 'Нет квеста Новое начало', description: 'Не нашёл в списке', createdAt: '2026-11-08T04:00:00Z', files: 0,
  email: 'player@example.com', work: { status: 'taken' }, ...extra,
})
const page = (rows: ReportRow[]): ReportPage => ({ rows, total: rows.length, counts: { active: 0, working: rows.length, closed: 0, awaiting: 0 } })

afterEach(cleanup)

describe('«Готово» asks «Выдать 1 день?» (owner, 08.11.2026)', () => {
  const setup = (rows = [row()]) => {
    const onAct = vi.fn(async () => undefined)
    const onReward = vi.fn(async () => undefined)
    render(<ReportsTable page={page(rows)} view="working" onView={() => {}} onAct={onAct} onReward={onReward} />)
    return { onAct, onReward }
  }

  it('«Да»: the report closes and its author gets one day', async () => {
    const { onAct, onReward } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(onAct).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: 'Выдать 1 день?' })
    expect(dialog).toHaveTextContent('№100 · Нет квеста Новое начало')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Да' })) })
    expect(onAct).toHaveBeenCalledWith(100, 'implemented')
    expect(onReward).toHaveBeenCalledWith(100, 1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('«Нет»: only closes it; Escape changes nothing', async () => {
    const { onAct, onReward } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onAct).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Нет' })) })
    expect(onAct).toHaveBeenCalledWith(100, 'implemented')
    expect(onReward).not.toHaveBeenCalled()
  })

  it('no author to reward (the account is gone): «Готово» closes at once', async () => {
    const { onAct } = setup([row({ email: undefined })])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Готово' })) })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onAct).toHaveBeenCalledWith(100, 'implemented')
  })
})
