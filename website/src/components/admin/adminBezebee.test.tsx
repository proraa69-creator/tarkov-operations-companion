import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** «BZB — автозачисление оплат» (owner, 20.10.2026): webhook address, key + secret, unmatched payments attached by hand. */
const mocks = vi.hoisted(() => ({ status: vi.fn(), events: vi.fn(), credentials: vi.fn(), attach: vi.fn(), payload: vi.fn() }))
vi.mock('../../auth', () => ({ useAuth: () => ({ token: 'owner-token', account: { owner: true } }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminBezebeeStatus: mocks.status, adminBezebeeEvents: mocks.events, adminBezebeeCredentials: mocks.credentials, adminBezebeeAttach: mocks.attach, adminBezebeePayload: mocks.payload } }
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
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }))
    await waitFor(() => expect(mocks.credentials).toHaveBeenCalledWith('owner-token', { webhookSecret: 'whsec_1' }))
    fireEvent.change(screen.getByPlaceholderText('e-mail аккаунта Raid OS'), { target: { value: 'buyer@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Привязать к аккаунту/ }))
    await waitFor(() => expect(mocks.attach).toHaveBeenCalledWith('owner-token', 7, 'buyer@example.com'))
  })
})
