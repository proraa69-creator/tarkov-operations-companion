import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ plans: vi.fn(), payments: vi.fn(() => new Promise(() => {})), createPayment: vi.fn() }))
vi.mock('../auth', () => ({ useAuth: () => ({
  status: 'ready', token: 'session-token',
  account: { email: 'player@example.com', kind: 'user', createdAt: '2026-10-01T00:00:00Z', nicknames: {}, subscription: { status: 'inactive' }, emailVerifiedAt: '2026-10-01T00:00:00Z' },
  logout: vi.fn(), reload: vi.fn(), setAccount: vi.fn(),
}) }))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  return { ...actual, api: new Proxy({}, { get: (_target, key) => {
    if (key === 'plans') return mocks.plans
    if (key === 'payments') return mocks.payments
    if (key === 'createPayment') return mocks.createPayment
    return () => new Promise(() => {})
  } }) }
})
const { CabinetPage } = await import('./CabinetPage')
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('subscription checkout', () => {
  it.each(['disabled', 'offline'])('shows four inactive payment buttons when the provider is %s', async (mode) => {
    if (mode === 'offline') mocks.plans.mockRejectedValue(new Error('offline'))
    else mocks.plans.mockResolvedValue({ enabled: mode === 'enabled', plans: [], providers: { yookassa: mode === 'enabled', lava: false, autopay: false }, foreign: null })
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    const panel = within(screen.getByRole('region', { name: 'Подписка' }))
    for (const label of ['1 месяц', '3 месяца', '6 месяцев', '12 месяцев']) {
      const button = panel.getByRole('button', { name: `Оплатить ${label}` })
      expect(button).toBeDisabled()
      fireEvent.click(button)
    }
    expect(panel.getByText('300 ₽')).toBeInTheDocument()
    expect(panel.getByText('900 ₽')).toBeInTheDocument()
    expect(panel.getByText('1 500 ₽')).toBeInTheDocument()
    expect(panel.getByText('≈ 250 ₽ в месяц')).toBeInTheDocument()
    expect(panel.getByText('−17%')).toBeInTheDocument()
    expect(panel.getByText('2 400 ₽')).toBeInTheDocument()
    expect(panel.getByText('≈ 200 ₽ в месяц')).toBeInTheDocument()
    expect(panel.getByText('−33%')).toBeInTheDocument()
    await vi.waitFor(() => expect(mocks.plans).toHaveBeenCalled())
    expect(mocks.createPayment).not.toHaveBeenCalled()
  })

  it('requires consent and starts an SBP payment with the published legal version', async () => {
    mocks.plans.mockResolvedValue({
      enabled: true,
      plans: [
        { id: '1m', months: 1, price: 300, currency: 'RUB', discountPercent: 0 },
        { id: '3m', months: 3, price: 900, currency: 'RUB', discountPercent: 0 },
        { id: '6m', months: 6, price: 1500, currency: 'RUB', discountPercent: 17 },
        { id: '12m', months: 12, price: 2400, currency: 'RUB', discountPercent: 33 },
      ],
      providers: { yookassa: true, lava: false, autopay: false, methods: ['sbp', 'sberbank', 'tinkoff_bank'] }, foreign: null,
    })
    mocks.createPayment.mockReturnValue(new Promise(() => {}))
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    const button = await screen.findByRole('button', { name: 'Оплатить 1 месяц' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: /1 месяц/ })
    const submit = within(dialog).getByRole('button', { name: 'Перейти к оплате' })
    expect(submit).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(submit)
    await vi.waitFor(() => expect(mocks.createPayment).toHaveBeenCalledWith('session-token', '1m', '2026-10-09.2', { region: 'ru', method: 'sbp', language: 'ru' }))
  })

  it('allows another payment while the previous payment is still being checked', async () => {
    mocks.plans.mockResolvedValue({
      enabled: true,
      plans: [{ id: '1m', months: 1, price: 300, currency: 'RUB', discountPercent: 0 }],
      providers: { yookassa: true, lava: false, autopay: false, methods: ['sbp'] }, foreign: null,
    })
    render(<MemoryRouter initialEntries={['/cabinet?payment=0123456789abcdef01234567']}><CabinetPage /></MemoryRouter>)

    expect(await screen.findByText('Проверяем предыдущую оплату…')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Оплатить 1 месяц' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(screen.getByRole('dialog', { name: /1 месяц/ })).toBeInTheDocument()
  })

  it('shows the invitation price in the dialog and keeps it for a retry', async () => {
    mocks.plans.mockResolvedValue({
      enabled: true,
      plans: [{ id: '1m', months: 1, price: 300, currency: 'RUB', discountPercent: 0 }],
      providers: { yookassa: true, lava: false, autopay: false, methods: ['sbp'] }, foreign: null,
    })
    mocks.payments.mockResolvedValue({ payments: [], autopay: null, friendDiscount: { percent: 20, plan: '1m' } })
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)

    await screen.findByText('240 ₽')
    fireEvent.click(await screen.findByRole('button', { name: 'Оплатить 1 месяц' }))
    const dialog = await screen.findByRole('dialog', { name: /1 месяц.*240/ })
    expect(within(dialog).getAllByText('240 ₽').length).toBeGreaterThan(0)
  })

  it('starts a T-Pay payment with autopay only after both checkboxes are selected', async () => {
    mocks.plans.mockResolvedValue({
      enabled: true,
      plans: [{ id: '1m', months: 1, price: 300, currency: 'RUB', discountPercent: 0 }],
      providers: { yookassa: true, lava: false, autopay: true, methods: ['sbp', 'sberbank', 'tinkoff_bank'] }, foreign: null,
    })
    mocks.createPayment.mockReturnValue(new Promise(() => {}))
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Оплатить 1 месяц' }))
    const dialog = screen.getByRole('dialog', { name: /1 месяц/ })
    fireEvent.click(within(dialog).getByRole('radio', { name: /T-Pay/ }))
    const checkboxes = within(dialog).getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]!)
    fireEvent.click(checkboxes[1]!)
    expect(within(dialog).getByText(/выбранный способ оплаты сохранится в ЮKassa/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перейти к оплате' }))
    await vi.waitFor(() => expect(mocks.createPayment).toHaveBeenCalledWith('session-token', '1m', '2026-10-09.2', {
      region: 'ru', method: 'tinkoff_bank', language: 'ru', autopayVersion: '2026-10-09.2',
    }))
  })
})
