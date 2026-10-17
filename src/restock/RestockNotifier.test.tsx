import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../i18n/renderText', () => ({ uiText: (text: unknown) => text }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp' }) }))
const start = Date.parse('2026-10-15T10:00:00.000Z')
// Prapor restocks in 2 minutes: inside the default 3-minute lead.
vi.mock('./restockSource', () => ({
  useTraderResets: () => ({ data: [{ id: 'prapor', name: 'Прапор', resetTime: new Date(start + 2 * 60_000).toISOString() }], isLoading: false }),
}))

const { RestockNotifier } = await import('./RestockWidgets')
const { writeRestockSettings } = await import('./restockSettings')

/** Owner, 15.10.2026: «уведомления о рестоке, даже если выключено, то все равно уведомления появляются». */
describe('restock notifications follow the switch', () => {
  let notify: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers({ now: start })
    localStorage.clear()
    notify = vi.fn(async () => true)
    Object.assign(window, { tarkovDesktop: { isDesktop: true, notify } })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'tarkovDesktop')
  })

  it('off: no system notification and no message, even for a chosen trader', () => {
    act(() => { writeRestockSettings({ enabled: false, traderIds: ['prapor'] }) })
    render(<RestockNotifier />)
    expect(notify).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('on: notifies once; turning it off removes the message at once', () => {
    act(() => { writeRestockSettings({ enabled: true, traderIds: ['prapor'] }) })
    render(<RestockNotifier />)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toContain('Прапор')
    act(() => { writeRestockSettings({ enabled: false }) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a trader taken off the list loses its message; a message goes by itself once the restock has passed', async () => {
    act(() => { writeRestockSettings({ enabled: true, traderIds: ['prapor'] }) })
    const view = render(<RestockNotifier />)
    act(() => { writeRestockSettings({ traderIds: [] }) })
    expect(screen.queryByRole('status')).toBeNull()
    view.unmount()

    localStorage.clear()
    act(() => { writeRestockSettings({ enabled: true, traderIds: ['prapor'] }) })
    render(<RestockNotifier />)
    expect(screen.getByRole('status')).toBeTruthy()
    // The notifier wakes at least once a minute; each wake-up renders before the next one is set.
    for (let step = 0; step < 3; step++) await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
