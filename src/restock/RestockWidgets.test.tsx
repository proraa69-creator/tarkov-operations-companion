import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../i18n/renderText', () => ({ uiText: (text: unknown) => text }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp' }) }))
const start = Date.parse('2026-10-14T10:00:00.000Z')
vi.mock('./restockSource', () => ({
  useTraderResets: () => ({ data: [{ id: 'prapor', name: 'Прапор', resetTime: new Date(start + 10 * 60_000).toISOString() }], isLoading: false }),
}))

const { TopbarRestock, TraderRestockTimer, RestockSettingsPanel } = await import('./RestockWidgets')
const { writeRestockSettings } = await import('./restockSettings')

describe('restocks switched off (owner, 15.10.2026: «при выключеном, не должно быть данных о рестоке»)', () => {
  beforeEach(() => { localStorage.clear(); writeRestockSettings({ enabled: false }) })
  afterEach(() => { cleanup(); localStorage.clear() })

  it('no top-bar countdown, no trader timer, only the switch in Settings', () => {
    const view = render(<MemoryRouter><TopbarRestock /><TraderRestockTimer trader={{ id: 'prapor', name: 'Прапор' }} /><RestockSettingsPanel /></MemoryRouter>)
    expect(view.container.querySelector('.restock-pill')).toBeNull()
    expect(view.container.querySelector('.restock-timer')).toBeNull()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('Прапор')).toBeNull()
    expect(screen.queryByText('За сколько минут')).toBeNull()
  })

  it('switched on: the countdown and the trader timer show', () => {
    vi.useFakeTimers({ now: start })
    writeRestockSettings({ enabled: true })
    const view = render(<MemoryRouter><TopbarRestock /><TraderRestockTimer trader={{ id: 'prapor', name: 'Прапор' }} /></MemoryRouter>)
    expect(view.container.querySelector('.restock-pill')).not.toBeNull()
    expect(view.container.querySelector('.restock-timer')).not.toBeNull()
    vi.useRealTimers()
  })
})

describe('top-bar restock countdown', () => {
  let focus: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.useFakeTimers({ now: start })
    writeRestockSettings({ enabled: true })
    focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    Object.assign(window, { tarkovDesktop: { isDesktop: true } })
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'tarkovDesktop')
  })

  const shown = () => screen.getByRole('button').querySelector('strong')?.textContent
  const pass = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

  it('ticks every second while the window is in use, not behind the game, and is right again on the way back', async () => {
    render(<MemoryRouter><TopbarRestock /></MemoryRouter>)
    expect(shown()).toBe('10:00')
    await pass(3000)
    expect(shown()).toBe('9:57')

    focus.mockReturnValue(false)
    act(() => { window.dispatchEvent(new Event('blur')) })
    await pass(60_000)
    // Not re-rendered behind the game.
    expect(shown()).toBe('9:57')

    focus.mockReturnValue(true)
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(shown()).toBe('8:57')
    await pass(1000)
    expect(shown()).toBe('8:56')
  })
})
