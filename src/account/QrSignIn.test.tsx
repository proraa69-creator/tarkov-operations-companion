import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QrSignIn } from './QrSignIn'

vi.mock('../sync/serverSync', () => ({ cleanIpcError: (reason: unknown) => String(reason), useServerAccount: () => ({ refresh: () => Promise.resolve() }) }))

afterEach(() => {
  vi.useRealTimers()
  delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
})

describe('«Войти по QR-коду»', () => {
  it('the PC shows a QR code and its code, waits for the phone and signs in by itself', async () => {
    vi.useFakeTimers()
    const status = { signedIn: true, online: true, email: 'p@example.com' }
    const qrPoll = vi.fn().mockResolvedValueOnce({ state: 'pending' }).mockResolvedValueOnce({ state: 'done', status })
    ;(window as { tarkovDesktop?: unknown }).tarkovDesktop = { account: { qrStart: vi.fn().mockResolvedValue({ code: 'ABCD-EFGH', expiresAt: new Date(Date.now() + 120_000).toISOString(), url: 'https://raidos.app/app-login#approve=ABCD-EFGH' }), qrPoll } }
    const onSignedIn = vi.fn()
    render(<QrSignIn onSignedIn={onSignedIn} onBack={() => {}} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('ABCD-EFGH')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(qrPoll).toHaveBeenCalledTimes(2)
    expect(onSignedIn).toHaveBeenCalledWith(status)
  })

  it('the phone explains the way through the PC app', () => {
    const onBack = vi.fn()
    render(<QrSignIn onSignedIn={() => {}} onBack={onBack} />)
    expect(screen.getByText(/«Войти в мобильную версию»/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Войти по e-mail и паролю/ }))
    expect(onBack).toHaveBeenCalled()
  })

  // Owner, 15.11.2026: «Войти через Google» on the PC — the browser does the Google part, this PC signs in by itself.
  it('«Войти через Google»: the PC opens the sign-in page in the browser once, shows its code, and signs in when the browser confirms', async () => {
    vi.useFakeTimers()
    const status = { signedIn: true, online: true, email: 'p@example.com' }
    const qrPoll = vi.fn().mockResolvedValueOnce({ state: 'done', status })
    const url = 'https://raidos.app/app-login#approve=ABCD-EFGH'
    ;(window as { tarkovDesktop?: unknown }).tarkovDesktop = { account: { qrStart: vi.fn().mockResolvedValue({ code: 'ABCD-EFGH', expiresAt: new Date(Date.now() + 120_000).toISOString(), url }), qrPoll } }
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onSignedIn = vi.fn()
    render(<QrSignIn onSignedIn={onSignedIn} onBack={() => {}} google />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('heading', { name: 'Вход через Google' })).toBeInTheDocument()
    expect(screen.getByText('ABCD-EFGH')).toBeInTheDocument()
    expect(screen.queryByLabelText('QR-код для входа')).toBeNull()
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener')
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(onSignedIn).toHaveBeenCalledWith(status)
    open.mockRestore()
  })
})
