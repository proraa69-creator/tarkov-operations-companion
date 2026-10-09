import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ plans: vi.fn(), createPayment: vi.fn() }))
vi.mock('../auth', () => ({ useAuth: () => ({
  status: 'ready', token: 'session-token',
  account: { email: 'player@example.com', kind: 'user', createdAt: '2026-10-01T00:00:00Z', nicknames: {}, subscription: { status: 'inactive' }, emailVerifiedAt: '2026-10-01T00:00:00Z' },
  logout: vi.fn(), reload: vi.fn(), setAccount: vi.fn(),
}) }))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  return { ...actual, api: new Proxy({}, { get: (_target, key) => {
    if (key === 'plans') return mocks.plans
    if (key === 'createPayment') return mocks.createPayment
    return () => new Promise(() => {})
  } }) }
})
const { CabinetPage } = await import('./CabinetPage')
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('subscription preview with checkout disabled', () => {
  it.each(['disabled', 'enabled', 'offline'])('shows four inactive payment buttons when the provider is %s', async (mode) => {
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
})
