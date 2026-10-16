import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Boosty for CIS / WORLD (docs/payments/payment-regions-and-announcements.md): the owner's e-mail warning must be
 * acknowledged before every redirect; the link comes from the server only after that; the friend offer only when listed.
 */
const mocks = vi.hoisted(() => ({ boostyLink: vi.fn(), assign: vi.fn() }))

vi.mock('../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'session-token', account: { email: 'buyer@example.com' } }) }))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  return { ...actual, api: { boostyLink: mocks.boostyLink } }
})

const { BoostyOffers } = await import('./BoostyCheckout')
const { setSiteLocale } = await import('../i18n')
const { BOOSTY_EMAIL_WARNING } = await import('../../../src/shared/paymentRegions')

const realLocation = window.location
afterEach(() => {
  cleanup()
  setSiteLocale('ru')
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

function stubLocation() {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, assign: mocks.assign } })
}

describe('Boosty checkout on the website', () => {
  it('shows the exact Russian warning; nothing is requested or opened until it is acknowledged', async () => {
    stubLocation()
    const url = 'https://boosty.to/raidosapp/purchase/4136107?ssource=DIRECT&share=subscription_link'
    mocks.boostyLink.mockResolvedValue({ url, region: 'CIS', offer: 'standard' })
    const user = userEvent.setup()
    render(<BoostyOffers region="CIS" offers={['standard']} email="buyer@example.com" />)
    expect(screen.queryByRole('button', { name: /скидкой друга/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Оплатить через Boosty' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(BOOSTY_EMAIL_WARNING.ru)
    expect(dialog).toHaveTextContent('buyer@example.com')
    const go = screen.getByRole('button', { name: 'Перейти на Boosty' })
    expect(go).toBeDisabled()
    await user.click(go)
    expect(mocks.boostyLink).not.toHaveBeenCalled()
    await user.click(screen.getByRole('checkbox', { name: 'Понятно: укажу на Boosty этот email' }))
    await user.click(go)
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith(url))
    expect(mocks.boostyLink).toHaveBeenCalledWith('session-token', 'standard')
  })

  it('asks again before every redirect and shows the friend offer only when the server lists it', async () => {
    const user = userEvent.setup()
    render(<BoostyOffers region="WORLD" offers={['standard', 'friend']} email="buyer@example.com" />)
    await user.click(screen.getByRole('button', { name: 'Оплатить со скидкой друга (один раз)' }))
    expect(screen.getByRole('button', { name: 'Перейти на Boosty' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    await user.click(screen.getByRole('button', { name: 'Оплатить через Boosty' }))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Перейти на Boosty' })).toBeDisabled()
  })

  it('shows the exact English warning in English', async () => {
    setSiteLocale('en')
    const user = userEvent.setup()
    render(<BoostyOffers region="WORLD" offers={['standard']} email="buyer@example.com" />)
    await user.click(screen.getByRole('button', { name: 'Pay via Boosty' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(BOOSTY_EMAIL_WARNING.en)
    expect(screen.getByRole('button', { name: 'Go to Boosty' })).toBeDisabled()
  })

  it('shows the server\'s refusal and stays on the page', async () => {
    stubLocation()
    const { ApiError } = await import('../api')
    mocks.boostyLink.mockRejectedValue(new ApiError(403, 'Скидка друга недоступна для этого аккаунта'))
    const user = userEvent.setup()
    render(<BoostyOffers region="CIS" offers={['standard', 'friend']} email="buyer@example.com" />)
    await user.click(screen.getByRole('button', { name: 'Оплатить со скидкой друга (один раз)' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Перейти на Boosty' }))
    expect(await screen.findByText('Скидка друга недоступна для этого аккаунта')).toBeInTheDocument()
    expect(mocks.assign).not.toHaveBeenCalled()
  })
})
