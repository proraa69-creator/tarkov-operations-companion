import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupportButtons } from './SupportButtons'
import { setRenderLanguage } from '../i18n/renderText'
import { resetSupportChat } from '../support/supportChatClient'
import { refreshServerStatus } from '../sync/serverSync'
import { OWNER_ONLINE_PATH, OWNER_ONLINE_REFRESH_MS } from '../data/ownerOnline'

/** «Онлайн сейчас: N» under «Ваши предложения» in the owner app (owner, 14.10.2026). */
const signedIn = { signedIn: true, email: 'owner@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true }
const signedOut = { signedIn: false, online: true, serverUrl: 'https://raidos.app', persistent: true }
const ONLINE = { online: 3, pc: 2, phone: 1, windowMinutes: 5, at: '2026-10-14T12:00:00.000Z' }

async function desktop(edition: 'owner' | 'client', status: unknown = signedIn) {
  const serviceRequest = vi.fn(async (method: string, path: string) => {
    if (path === OWNER_ONLINE_PATH) return ONLINE
    if (path.startsWith('/v1/me/support')) return { messages: [], unread: 0 }
    return null
  })
  Object.assign(window, { tarkovDesktop: { isDesktop: true, edition, serviceRequest, account: { status: vi.fn().mockResolvedValue(status), login: vi.fn(), logout: vi.fn() } } })
  await refreshServerStatus()
  return serviceRequest
}
const onlineCalls = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([, path]) => path === OWNER_ONLINE_PATH).length
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('OwnerOnlineLine', () => {
  afterEach(async () => {
    cleanup()
    vi.useRealTimers()
    setRenderLanguage('ru')
    Reflect.deleteProperty(document, 'visibilityState')
    await desktop('client', signedOut)
    Reflect.deleteProperty(window, 'tarkovDesktop')
    resetSupportChat()
  })

  it('the owner app shows the count right under «Ваши предложения», with the PC / phone split and the window', async () => {
    const request = await desktop('owner')
    render(<SupportButtons variant="nav" />)
    const line = await screen.findByRole('status', { name: /Онлайн сейчас: 3/ })
    expect(line).toHaveTextContent('Онлайн сейчас: 3')
    expect(line).toHaveTextContent('ПК 2 · телефон 1')
    expect(line).toHaveAttribute('title', 'Аккаунты в приложении для ПК или телефона за последние 5 мин.')
    // Right after the «Ваши предложения» button.
    expect(screen.getByRole('button', { name: 'Ваши предложения' }).nextElementSibling).toBe(line)
    expect(request).toHaveBeenCalledWith('GET', OWNER_ONLINE_PATH)
  })

  it('in English: «Online now: N»', async () => {
    setRenderLanguage('en')
    await desktop('owner')
    render(<SupportButtons variant="nav" />)
    const line = await screen.findByRole('status', { name: /Online now: 3/ })
    expect(line).toHaveTextContent('Online now: 3')
    expect(line).toHaveTextContent('PC 2 · phone 1')
    expect(line).toHaveAttribute('title', 'Accounts in the PC or phone app within the last 5 min.')
    expect(screen.getByRole('button', { name: 'Your suggestions' })).toBeInTheDocument()
  })

  it('players never see it and never ask (Russian and English)', async () => {
    for (const language of ['ru', 'en'] as const) {
      setRenderLanguage(language)
      const request = await desktop('client')
      render(<SupportButtons variant="nav" />)
      await screen.findByRole('button', { name: language === 'en' ? 'Your suggestions' : 'Ваши предложения' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(screen.queryByRole('status')).toBeNull()
      expect(screen.queryByText(/Онлайн сейчас|Online now/)).toBeNull()
      expect(onlineCalls(request)).toBe(0)
      cleanup()
    }
  })

  it('not in the settings panel, and not while the owner is signed out', async () => {
    const request = await desktop('owner', signedOut)
    render(<SupportButtons variant="nav" />)
    render(<SupportButtons variant="panel" />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('status')).toBeNull()
    expect(onlineCalls(request)).toBe(0)
  })

  it('refreshes every ~45 s and on focus, and stops while the window is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const request = await desktop('owner')
    render(<SupportButtons variant="nav" />)
    await screen.findByRole('status')
    expect(onlineCalls(request)).toBe(1)
    await act(async () => { vi.advanceTimersByTime(OWNER_ONLINE_REFRESH_MS) })
    await waitFor(() => expect(onlineCalls(request)).toBe(2))
    // Focus right after an answer does not ask again.
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(onlineCalls(request)).toBe(2)
    act(() => setVisibility('hidden'))
    await act(async () => { vi.advanceTimersByTime(OWNER_ONLINE_REFRESH_MS * 3) })
    expect(onlineCalls(request)).toBe(2)
    act(() => setVisibility('visible'))
    await waitFor(() => expect(onlineCalls(request)).toBe(3))
    await act(async () => { vi.advanceTimersByTime(OWNER_ONLINE_REFRESH_MS) })
    await waitFor(() => expect(onlineCalls(request)).toBe(4))
  })
})
