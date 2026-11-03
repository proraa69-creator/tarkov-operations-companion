import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUIDE_TIMING } from './guideProgress'

const status = vi.hoisted(() => ({ value: null as null | { signedIn: boolean; email?: string; subscription?: { status: string } } }))
vi.mock('../sync/serverSync', () => ({ useServerStatus: () => status.value }))

const { ScreenshotKeyTip, SCREENSHOT_KEY_TIP_PREFIX } = await import('./ScreenshotKeyTip')

const open = () => render(<MemoryRouter initialEntries={['/maps/customs']}><ScreenshotKeyTip /></MemoryRouter>)
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
  it('a new player sees it once, the first time the map is opened in the PC app (01.11.2026)', async () => {
    status.value = { signedIn: true, email: 'New@Example.com', subscription: { status: 'trial' } }
    const view = open()
    await settle()
    const tip = screen.getByRole('dialog', { name: 'Местоположение на карте' })
    expect(tip).toHaveTextContent('«Настройки» → «Управление» → в самом низу «Сделать скриншот» → назначьте клавишу')
    expect(localStorage.getItem(`${SCREENSHOT_KEY_TIP_PREFIX}new@example.com`)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('not on another page', async () => {
    status.value = { signedIn: true, email: 'new@example.com', subscription: { status: 'trial' } }
    render(<MemoryRouter initialEntries={['/']}><ScreenshotKeyTip /></MemoryRouter>)
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(`${SCREENSHOT_KEY_TIP_PREFIX}new@example.com`)).toBeNull()
  })

  it('a newcomer who paid at once sees it too; not when the map already has a dot (03.11.2026)', async () => {
    status.value = { signedIn: true, email: 'paid@example.com', subscription: { status: 'active' } }
    const paid = open()
    await settle()
    expect(screen.getByRole('dialog', { name: 'Местоположение на карте' })).toBeInTheDocument()
    paid.unmount()
    // The game's screenshots already give a position: the player knows the key.
    let tell: (position: unknown) => void = () => {}
    window.tarkovDesktop = { experimental: { onPosition: (callback: (position: unknown) => void) => { tell = callback; return () => {} } } } as unknown as typeof window.tarkovDesktop
    status.value = { signedIn: true, email: 'veteran@example.com', subscription: { status: 'active' } }
    open()
    act(() => tell({ x: 1, y: 2, z: 3, yaw: 0, at: 1, map: 'customs' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(`${SCREENSHOT_KEY_TIP_PREFIX}veteran@example.com`)).toBeNull()
  })

  it('not without a sign-in, not on the phone', async () => {
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
