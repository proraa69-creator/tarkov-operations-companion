import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** «BZB — автозачисление оплат» (owner, 20.10.2026): webhook address, key + secret, unmatched payments attached by hand. */
const mocks = vi.hoisted(() => ({ status: vi.fn(), events: vi.fn(), credentials: vi.fn(), attach: vi.fn(), payload: vi.fn(), dismiss: vi.fn(), confirm: vi.fn(), mailCheck: vi.fn() }))
vi.mock('../../auth', () => ({ useAuth: () => ({ token: 'owner-token', account: { owner: true } }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminBezebeeStatus: mocks.status, adminBezebeeEvents: mocks.events, adminBezebeeCredentials: mocks.credentials, adminBezebeeAttach: mocks.attach, adminBezebeePayload: mocks.payload, adminBezebeeDismiss: mocks.dismiss, adminBezebeeConfirm: mocks.confirm, adminBezebeeMailCheck: mocks.mailCheck } }
})
const { AdminBezebee } = await import('./AdminBezebee')

describe('AdminBezebee', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('shows the address for BZB, saves the key and secret, attaches a Telegram-only payment to an account', async () => {
    mocks.status.mockResolvedValue({ apiToken: false, webhookSecret: false, webhookUrl: 'https://raidos.app/v1/payments/bezebee/webhook' })
    mocks.events.mockResolvedValue({ total: 1, unmatched: 1, events: [{ id: 7, receivedAt: '2026-10-20T10:00:00Z', status: 'unmatched', signature: 'ok', plan: '6m', region: 'CIS', telegram: '@buyer', detail: 'Покупатель указал только Telegram' }] })
    mocks.credentials.mockResolvedValue({ apiToken: true, webhookSecret: true, webhookUrl: 'https://raidos.app/v1/payments/bezebee/webhook' })
    mocks.attach.mockResolvedValue({ event: { id: 7, status: 'confirmed' } })
    render(<AdminBezebee />)
    expect(await screen.findByText('https://raidos.app/v1/payments/bezebee/webhook')).toBeInTheDocument()
    expect(screen.getByText('Автозачисление выключено')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Секрет подписи вебхуков/), { target: { value: 'whsec_1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(mocks.credentials).toHaveBeenCalledWith('owner-token', { webhookSecret: 'whsec_1' }))
    fireEvent.change(screen.getByPlaceholderText('e-mail аккаунта Raid OS'), { target: { value: 'buyer@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Привязать к аккаунту/ }))
    await waitFor(() => expect(mocks.attach).toHaveBeenCalledWith('owner-token', 7, 'buyer@example.com'))
  })

  it('«Убрать» drops a stray notification; «Зачислить вручную» credits a payment that sent none', async () => {
    mocks.status.mockResolvedValue({ apiToken: true, webhookSecret: true, webhookUrl: 'https://raidos.app/v1/payments/bezebee/webhook' })
    mocks.events.mockResolvedValue({ total: 1, unmatched: 1, events: [{ id: 3, receivedAt: '2026-10-20T08:53:00Z', status: 'unverified', signature: 'unsigned', detail: 'Секрет подписи вебхуков не задан' }] })
    mocks.dismiss.mockResolvedValue({ event: { id: 3, status: 'ignored' } })
    mocks.confirm.mockResolvedValue({ payment: { id: 'p1' } })
    render(<AdminBezebee />)
    fireEvent.click(await screen.findByRole('button', { name: /Убрать/ }))
    await waitFor(() => expect(mocks.dismiss).toHaveBeenCalledWith('owner-token', 3))
    fireEvent.change(screen.getByLabelText('E-mail аккаунта'), { target: { value: 'global@example.com' } })
    fireEvent.change(screen.getByLabelText('Сумма в рублях'), { target: { value: '630' } })
    fireEvent.click(screen.getByRole('button', { name: /Зачислить/ }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('owner-token', { email: 'global@example.com', plan: '1m', amount: 630 }))
    expect(await screen.findByText('Оплата зачислена на global@example.com.')).toBeInTheDocument()
  })

  it('the mailbox with BZB\'s sale letters: address and app password saved and checked at once; a wrong password is shown', async () => {
    const url = 'https://raidos.app/v1/payments/bezebee/webhook'
    mocks.status.mockResolvedValue({ apiToken: false, webhookSecret: false, webhookUrl: url, mail: { configured: false, read: 0 } })
    mocks.events.mockResolvedValue({ total: 0, unmatched: 0, events: [] })
    mocks.credentials.mockResolvedValue({ apiToken: false, webhookSecret: false, webhookUrl: url, mail: { configured: true, user: 'raidosapp@gmail.com', read: 1, error: 'Почта не пустила: проверьте адрес и пароль приложения' } })
    render(<AdminBezebee />)
    expect(await screen.findByText('Автозачисление выключено')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Адрес ящика/), { target: { value: 'raidosapp@gmail.com' } })
    fireEvent.change(screen.getByLabelText(/Пароль приложения/), { target: { value: 'abcd efgh ijkl mnop' } })
    fireEvent.click(screen.getByRole('button', { name: /Сохранить и проверить/ }))
    await waitFor(() => expect(mocks.credentials).toHaveBeenCalledWith('owner-token', { mailUser: 'raidosapp@gmail.com', mailPassword: 'abcd efgh ijkl mnop' }))
    expect(await screen.findByText('Почта не пустила: проверьте адрес и пароль приложения')).toBeInTheDocument()

    cleanup()
    mocks.status.mockResolvedValue({ apiToken: false, webhookSecret: false, webhookUrl: url, mail: { configured: true, user: 'raidosapp@gmail.com', read: 3, checkedAt: '2026-10-20T20:00:00Z' } })
    mocks.mailCheck.mockResolvedValue({ mail: { configured: true, user: 'raidosapp@gmail.com', read: 4 } })
    render(<AdminBezebee />)
    expect(await screen.findByText('Автозачисление включено')).toBeInTheDocument()
    expect(screen.getByText(/читаются с raidosapp@gmail.com каждую минуту/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Проверить почту сейчас/ }))
    await waitFor(() => expect(mocks.mailCheck).toHaveBeenCalledWith('owner-token'))
    expect(await screen.findByText('Почта проверена.')).toBeInTheDocument()
  })
})
