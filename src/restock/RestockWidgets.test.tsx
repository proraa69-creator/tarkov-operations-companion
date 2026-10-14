import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../i18n/renderText', () => ({ uiText: (text: unknown) => text }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp' }) }))
const start = Date.parse('2026-10-14T10:00:00.000Z')
vi.mock('./restockSource', () => ({
  useTraderResets: () => ({ data: [{ id: 'prapor', name: 'Прапор', resetTime: new Date(start + 10 * 60_000).toISOString() }], isLoading: false }),
}))

const { TopbarRestock } = await import('./RestockWidgets')

describe('top-bar restock countdown', () => {
  let focus: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.useFakeTimers({ now: start })
    focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    Object.assign(window, { tarkovDesktop: { isDesktop: true } })
  })
  afterEach(() => {
    cleanup()
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
