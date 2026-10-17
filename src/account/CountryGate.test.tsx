import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerAccountStatus } from '../electron'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { CountryGate } from './CountryGate'
import { refreshServerStatus } from '../sync/serverSync'

/**
 * «Укажите страну» over the app (owner, 15.10.2026) against a mocked desktop gateway (window.tarkovDesktop, the IPC of
 * electron/preload.ts): shown only when the server says the account has no country, not dismissible, sign-out works,
 * the list and the manual entry send what the server stores.
 */
const SERVER = 'https://raidos.app'
const signedIn: ServerAccountStatus = { signedIn: true, email: 'old@example.com', kind: 'user', online: true, serverUrl: SERVER, persistent: true }
const signedOut: ServerAccountStatus = { signedIn: false, online: true, serverUrl: SERVER, persistent: true }

function desktop(view: Record<string, unknown>) {
  const account = { status: vi.fn(async () => signedIn), logout: vi.fn(async () => signedOut), login: vi.fn(), openWebsite: vi.fn() }
  const serviceRequest = vi.fn(async (method: string, path: string, body?: unknown): Promise<unknown> => {
    if (method === 'GET' && path === '/v1/accounts/me') return view
    if (method === 'POST' && path === '/v1/accounts/me/initial-country') {
      const choice = body as { country?: string; other?: string }
      return { email: 'old@example.com', country: choice.country ?? 'XX', ...(choice.other ? { countryOther: choice.other } : {}) }
    }
    return null
  })
  Object.assign(window, { tarkovDesktop: { edition: 'client', serviceRequest, account } })
  return { account, serviceRequest }
}

async function open(locale: 'ru' | 'en' = 'ru') {
  localStorage.setItem('tarkov-operations-locale-v1', locale)
  await refreshServerStatus()
  const user = userEvent.setup()
  render(<LocaleProvider><CountryGate /></LocaleProvider>)
  return user
}

afterEach(async () => {
  cleanup()
  localStorage.clear()
  Reflect.deleteProperty(window, 'tarkovDesktop')
  await act(async () => { await refreshServerStatus() })
})

describe('«Укажите страну»', () => {
  it('is not shown to an account with a country, nor by a server that does not ask', async () => {
    const { serviceRequest } = desktop({ email: 'old@example.com', country: 'RU' })
    await open()
    await waitFor(() => expect(serviceRequest).toHaveBeenCalledWith('GET', '/v1/accounts/me'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    cleanup()
    desktop({ email: 'old@example.com' })
    await open()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cannot be closed: no close button, Escape and a click beside it keep it; sign-out works', async () => {
    const { account } = desktop({ email: 'old@example.com', needsCountry: true })
    const user = await open()
    const dialog = await screen.findByRole('dialog', { name: 'Укажите страну' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText(/Нужна для правильного языка уведомлений и поддержки/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Закрыть|✕/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(dialog)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Выйти из аккаунта' }))
    await waitFor(() => expect(account.logout).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('searching and picking stores the code', async () => {
    const { serviceRequest } = desktop({ email: 'old@example.com', needsCountry: true })
    const user = await open()
    await screen.findByRole('dialog')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    await user.type(screen.getByRole('combobox', { name: 'Поиск страны' }), 'казах')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Казахстан'])
    await user.click(screen.getByRole('option', { name: 'Казахстан' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить: Казахстан' }))
    await waitFor(() => expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/accounts/me/initial-country', { country: 'KZ' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('manual entry: checked before sending, a known name is pointed out, the cleaned text is sent', async () => {
    const { serviceRequest } = desktop({ email: 'old@example.com', needsCountry: true })
    const user = await open()
    await screen.findByRole('dialog')
    await user.type(screen.getByRole('combobox', { name: 'Поиск страны' }), 'Атлантида')
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Моей страны нет в списке — ввести вручную' }))
    const field = screen.getByRole('textbox', { name: 'Название страны' })
    expect(field).toHaveValue('Атлантида')
    await user.clear(field)
    await user.type(field, 'Land 42')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Только буквы, пробелы и дефисы, до 60 символов.')
    expect(serviceRequest).not.toHaveBeenCalledWith('POST', '/v1/accounts/me/initial-country', expect.anything())
    await user.clear(field)
    await user.type(field, 'Kazakhstan')
    expect(screen.getByText('Есть в списке: Казахстан')).toBeInTheDocument()
    await user.clear(field)
    await user.type(field, '  Республика   Атлантида ')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/accounts/me/initial-country', { other: 'Республика Атлантида' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('speaks English when the app does', async () => {
    desktop({ email: 'old@example.com', needsCountry: true })
    await open('en')
    expect(await screen.findByRole('dialog', { name: 'Please select your country' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'My country is not listed — type it in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Kazakhstan' })).toBeInTheDocument()
  })
})
