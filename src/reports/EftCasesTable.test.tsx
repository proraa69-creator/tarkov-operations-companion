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

// Owner, 27.11.2026: a dispute over a game account goes to the owner — who holds it, who claims it, whether each paid and when.
const holder = { accountId: 'h', email: 'holder@example.com', deleted: false, createdAt: '2026-11-01T10:00:00.000Z', paid: false, payments: 0, bound: { eft: '••••321', at: '2026-11-02T10:00:00.000Z', disputed: true } }
const claimer = { accountId: 'd', email: 'payer@example.com', deleted: false, createdAt: '2026-11-20T10:00:00.000Z', paid: true, paidUntil: '2026-12-27T10:00:00.000Z', payments: 2 }
const disputed: EftCasesPage = {
  counts: { active: 0, working: 0, closed: 0 },
  rows: [],
  disputes: {
    counts: { active: 1, working: 0, closed: 1 },
    rows: [{ id: 3, kind: 'dispute', createdAt: '2026-11-27T10:00:00.000Z', seenAt: '2026-11-27T12:00:00.000Z', status: 'active', eft: '••••321', eftKey: 'c0ffee12', holder, disputer: claimer }],
  },
}
const decided: EftCasesPage = {
  counts: { active: 0, working: 0, closed: 0 },
  rows: [],
  disputes: {
    counts: { active: 1, working: 0, closed: 1 },
    rows: [{ id: 2, kind: 'dispute', createdAt: '2026-11-26T10:00:00.000Z', seenAt: '2026-11-26T10:00:00.000Z', status: 'closed', decision: 'keep', decidedAt: '2026-11-26T11:00:00.000Z', eft: '••••777', eftKey: 'feed1234', holder, disputer: { accountId: 'f', email: 'free@example.com', deleted: false, createdAt: '2026-11-25T10:00:00.000Z', paid: false, payments: 0 } }],
  },
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

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

  it('«Спор за аккаунт Таркова»: who holds it, who claims it, whether each paid; the owner keeps it, gives it or unbinds both', async () => {
    const load = vi.fn((view: string) => Promise.resolve(view === 'closed' ? decided : disputed))
    const disputes = { setStatus: vi.fn().mockResolvedValue({}), decide: vi.fn().mockResolvedValue({}) }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<EftCasesTable load={load} setStatus={vi.fn()} disputes={disputes} />)
    const row = await screen.findByTestId('eft-dispute')
    expect(screen.getByText('Спор за аккаунт Таркова')).toBeInTheDocument()
    expect(within(row).getByText('••••321')).toBeInTheDocument()
    expect(within(row).getByText('holder@example.com')).toBeInTheDocument()
    expect(within(row).getByText('payer@example.com')).toBeInTheDocument()
    expect(within(row).getByText(/^Не оплачен/)).toBeInTheDocument()
    expect(within(row).getByText(/^Оплачен · Premium до .* · платежей: 2$/)).toBeInTheDocument()
    expect(within(row).getByText(/^Таркова привязан/)).toBeInTheDocument()
    expect(within(row).getByText(/последний раз/)).toBeInTheDocument()
    // The tabs count both kinds of cases.
    expect(screen.getByRole('button', { name: /Активные.*1/ })).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: 'Отдать спорящему' }))
    expect(confirm).toHaveBeenCalledWith('Отдать привязку спорящему?')
    await waitFor(() => expect(disputes.decide).toHaveBeenCalledWith(3, 'transfer'))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    // A «no» to the question changes nothing.
    confirm.mockReturnValue(false)
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Снять обе' })).toBeEnabled())
    fireEvent.click(within(row).getByRole('button', { name: 'Снять обе' }))
    expect(disputes.decide).toHaveBeenCalledTimes(1)
    fireEvent.click(within(row).getByRole('button', { name: 'Оставить привязку' }))
    await waitFor(() => expect(disputes.decide).toHaveBeenLastCalledWith(3, 'keep'))
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Взять' })).toBeEnabled())
    fireEvent.click(within(row).getByRole('button', { name: 'Взять' }))
    await waitFor(() => expect(disputes.setStatus).toHaveBeenCalledWith(3, 'working'))

    // Closed: the decision, and «Вернуть» for a case left as it was.
    fireEvent.click(screen.getByRole('button', { name: /Закрытые/ }))
    const closed = await screen.findByText('Привязка оставлена', { exact: false })
    const closedRow = closed.closest('tr')!
    expect(within(closedRow).queryByRole('button', { name: 'Отдать спорящему' })).toBeNull()
    fireEvent.click(within(closedRow).getByRole('button', { name: 'Вернуть' }))
    await waitFor(() => expect(disputes.setStatus).toHaveBeenLastCalledWith(2, 'active'))
  })

  it('a host without the decision buttons shows the disputes only', async () => {
    render(<EftCasesTable load={vi.fn().mockResolvedValue(disputed)} setStatus={vi.fn()} />)
    const row = await screen.findByTestId('eft-dispute')
    expect(within(row).getByText('payer@example.com')).toBeInTheDocument()
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
  })
})
