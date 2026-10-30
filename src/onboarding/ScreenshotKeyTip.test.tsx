import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUIDE_TIMING } from './guideProgress'

const status = vi.hoisted(() => ({ value: null as null | { signedIn: boolean; email?: string; subscription?: { status: string } } }))
vi.mock('../sync/serverSync', () => ({ useServerStatus: () => status.value }))

const { ScreenshotKeyTip, SCREENSHOT_KEY_TIP_PREFIX } = await import('./ScreenshotKeyTip')

const open = () => render(<MemoryRouter initialEntries={['/']}><ScreenshotKeyTip /></MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
  window.tarkovDesktop = {} as typeof window.tarkovDesktop
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); delete (window as { tarkovDesktop?: unknown }).tarkovDesktop })

// Owner, 31.10.2026: «для тех людей кто в первый раз авторизуется в приложении, в пробный период и больше не надо будет…
// для работы местоположения, настройте клавишу скриншота в игре».
describe('the screenshot key window', () => {
  it('a new player in the free period sees it once on the Overview of the PC app', async () => {
    status.value = { signedIn: true, email: 'New@Example.com', subscription: { status: 'trial' } }
    const view = open()
    await settle()
    const tip = screen.getByRole('dialog', { name: 'Местоположение на карте' })
    expect(tip).toHaveTextContent('Для работы местоположения настройте клавишу скриншота в игре')
    expect(localStorage.getItem(`${SCREENSHOT_KEY_TIP_PREFIX}new@example.com`)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('not for a paying player, not without a sign-in, not on the phone', async () => {
    status.value = { signedIn: true, email: 'paid@example.com', subscription: { status: 'active' } }
    const paid = open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    paid.unmount()
    status.value = { signedIn: false }
    const out = open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    out.unmount()
    delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
    status.value = { signedIn: true, email: 'phone@example.com', subscription: { status: 'trial' } }
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
