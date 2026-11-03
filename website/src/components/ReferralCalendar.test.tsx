import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReferralSeriesRow } from '../api'
import { ReferralCalendar } from './ReferralCalendar'
import { ReferralStatsTable } from './ReferralStatsTable'

const day = (period: string, visits: number, registrations: number, payments: number, revenue = 0): ReferralSeriesRow =>
  ({ period, visits, registrations, payments, months: { '1m': payments, '3m': 0, '6m': 0, '12m': 0 }, revenue, earnings: 0 })

afterEach(() => { cleanup(); vi.useRealTimers() })

// Owner, 30.10.2026: «статистику стримера по дням в виде календаря… у него и у меня в кабинете».
describe('the streamer\'s calendar', () => {
  it('a month of days with visits, sign-ups and payments; the previous month on the arrow; revenue for the owner only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-30T09:00:00Z'))
    const load = vi.fn(async (month: string) => ({ rows: month === '2026-10' ? [day('2026-10-30', 12, 3, 1, 240), day('2026-10-01', 2, 0, 0)] : [day('2026-09-15', 5, 1, 0)] }))
    const view = render(<ReferralCalendar load={load} />)
    expect(await screen.findByRole('gridcell', { name: '30: Переходы 12, Регистрации 3, Оплаты 1' })).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell')).toHaveLength(31)
    expect(screen.queryByText(/Выручка/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    expect(await screen.findByRole('gridcell', { name: '15: Переходы 5, Регистрации 1, Оплаты 0' })).toBeInTheDocument()
    expect(load).toHaveBeenLastCalledWith('2026-09')
    view.unmount()

    render(<ReferralCalendar load={load} showRevenue />)
    // The day's cell and the month's total.
    expect(await screen.findAllByText('240 ₽')).toHaveLength(2)
  })
})

// Owner, 03.11.2026: «люди нажимали по его ссылке… а потом регистрировались сами… сделай реальное количество регистраций».
describe('registrations without the code', () => {
  it('the calendar counts them in the sign-ups of the day and names them; the table has their own column and total', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T09:00:00Z'))
    const rows = [{ ...day('2026-11-02', 30, 11, 1), linkRegistrations: 4 }, { ...day('2026-11-01', 122, 17, 0), linkRegistrations: 2 }]
    const view = render(<ReferralCalendar load={async () => ({ rows })} />)
    expect(await screen.findByRole('gridcell', { name: '2: Переходы 30, Регистрации 11 (без кода 4), Оплаты 1' })).toBeInTheDocument()
    expect(screen.getByText(/\(без кода 6\)/)).toBeInTheDocument()
    view.unmount()

    render(<ReferralStatsTable load={async () => ({ rows })} showEarnings={false} />)
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Без кода' })).toBeInTheDocument()
    const total = within(table).getByRole('rowheader', { name: 'Итого' }).closest('tr')!
    expect(within(total).getAllByRole('cell').map((cell) => cell.textContent).slice(0, 3)).toEqual(['152', '28', '6'])
    expect(screen.getByText(/с того же интернет-адреса в течение 7 дней после перехода по ссылке/)).toBeInTheDocument()
  })
})
