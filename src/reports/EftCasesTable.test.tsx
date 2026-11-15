import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EftCasesTable, type EftCasesPage } from './EftCasesTable'
import { ReportsTable } from './ReportsTable'

// Owner, 15.11.2026: «сделай отдельную вкладку… аккаунты Таркова… какой первый аккаунт, какая почта, потом актуальный сейчас, номер Таркова».
const page: EftCasesPage = {
  counts: { active: 1, working: 0, closed: 2 },
  rows: [{
    id: 7, createdAt: '2026-11-15T10:00:00.000Z', status: 'active', eft: '••••543', eftKey: 'a1b2c3d4',
    current: { accountId: 'new', email: 'second.try@gmail.com', deleted: false, createdAt: '2026-11-15T09:00:00.000Z', boundAt: '2026-11-15T10:00:00.000Z', trialByThisGame: false, trialDenied: true },
    previous: [{ accountId: 'old', email: 'fi•••@gmail.com', deleted: true, boundAt: '2026-11-01T10:00:00.000Z', goneAt: '2026-11-05T10:00:00.000Z', goneReason: 'deleted', trialByThisGame: true }],
  }],
}

afterEach(cleanup)

describe('«Аккаунты Таркова»', () => {
  it('shows the game account, the account now and the deleted one before it; the owner moves the case', async () => {
    const load = vi.fn().mockResolvedValue(page)
    const setStatus = vi.fn().mockResolvedValue({})
    render(<EftCasesTable load={load} setStatus={setStatus} />)
    const row = await screen.findByTestId('eft-case')
    expect(within(row).getByText('••••543')).toBeInTheDocument()
    expect(within(row).getByText('second.try@gmail.com')).toBeInTheDocument()
    expect(within(row).getByText('fi•••@gmail.com')).toBeInTheDocument()
    expect(within(row).getByText(/не выданы/)).toBeInTheDocument()
    expect(within(row).getByText(/удалён/)).toBeInTheDocument()
    expect(within(row).getByText(/брал бонусные дни/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Закрытые.*2/ })).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Взять' }))
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(7, 'working'))
    expect(load).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: /В процессе/ }))
    await waitFor(() => expect(load).toHaveBeenLastCalledWith('working'))
  })

  it('is a tab of «Отчёты» with the count of new cases; while chosen it takes the place of the reports', () => {
    const onSelect = vi.fn()
    const onView = vi.fn()
    const reports = { rows: [], total: 0, counts: { active: 0, working: 0, closed: 0, awaiting: 0 } }
    const { rerender } = render(<ReportsTable page={reports} view="active" onView={onView} onAct={async () => {}} eft={{ count: 3, selected: false, onSelect, content: <p>cases</p> }} />)
    const tab = screen.getByRole('button', { name: /Аккаунты Таркова.*3/ })
    expect(tab).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(tab)
    expect(onSelect).toHaveBeenCalled()
    rerender(<ReportsTable page={reports} view="active" onView={onView} onAct={async () => {}} eft={{ count: 3, selected: true, onSelect, content: <p>cases</p> }} />)
    expect(screen.getByText('cases')).toBeInTheDocument()
    expect(screen.queryByText('Активных отчётов и предложений нет.')).toBeNull()
    expect(screen.getByRole('button', { name: /^Активные/ })).toHaveAttribute('aria-pressed', 'false')
  })
})
