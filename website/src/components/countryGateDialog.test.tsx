import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * «Укажите страну» in the personal cabinet (owner, 15.10.2026): only for an account the server marks `needsCountry`,
 * not dismissible, sign-out works, the list and the manual entry go to POST /v1/accounts/me/initial-country.
 */
const mocks = vi.hoisted(() => ({
  account: null as unknown,
  listeners: new Set<() => void>(),
  setInitialCountry: vi.fn(),
  logout: vi.fn(async () => {}),
}))

vi.mock('../auth', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener) }
  const setAccount = (next: unknown) => { mocks.account = next; for (const listener of mocks.listeners) listener() }
  return {
    useAuth: () => {
      const account = useSyncExternalStore(subscribe, () => mocks.account)
      return { status: 'ready', token: 'session-token', account, error: null, reload: vi.fn(), logout: mocks.logout, setAccount }
    },
  }
})
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  return { ...actual, api: { setInitialCountry: mocks.setInitialCountry } }
})

const { CountryGateDialog } = await import('./CountryGateDialog')
const { setSiteLocale } = await import('../i18n')

afterEach(() => {
  cleanup()
  setSiteLocale('ru')
  vi.clearAllMocks()
})

describe('«Укажите страну» on the website', () => {
  it('is not shown to an account with a country', () => {
    mocks.account = { email: 'a@example.com', country: 'RU' }
    render(<CountryGateDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays on Escape, signs out, and saves a picked country', async () => {
    mocks.account = { email: 'old@example.com', needsCountry: true }
    mocks.setInitialCountry.mockResolvedValue({ email: 'old@example.com', country: 'DE' })
    const user = userEvent.setup()
    render(<CountryGateDialog />)
    expect(screen.getByRole('dialog', { name: 'Укажите страну' })).toHaveAttribute('aria-modal', 'true')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Выйти из аккаунта' }))
    expect(mocks.logout).toHaveBeenCalled()
    await user.type(screen.getByRole('combobox', { name: 'Поиск страны' }), 'герм')
    await user.click(screen.getByRole('option', { name: 'Германия' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить: Германия' }))
    await waitFor(() => expect(mocks.setInitialCountry).toHaveBeenCalledWith('session-token', { country: 'DE' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('sends a country typed by hand, in English too', async () => {
    setSiteLocale('en')
    mocks.account = { email: 'old@example.com', needsCountry: true }
    mocks.setInitialCountry.mockResolvedValue({ email: 'old@example.com', country: 'XX', countryOther: 'Atlantis' })
    const user = userEvent.setup()
    render(<CountryGateDialog />)
    expect(screen.getByRole('dialog', { name: 'Please select your country' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'My country is not listed — type it in' }))
    await user.type(screen.getByRole('textbox', { name: 'Country name' }), 'Atlantis')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.setInitialCountry).toHaveBeenCalledWith('session-token', { other: 'Atlantis' }))
  })
})
