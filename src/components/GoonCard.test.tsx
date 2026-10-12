import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { GoonCard } from './GoonCard'

const MAPS: Record<string, string> = { customs: 'Таможня', woods: 'Лес', shoreline: 'Берег', lighthouse: 'Маяк' }

describe('«Кочевники» card', () => {
  const serviceRequest = vi.fn()
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    Object.assign(window, { tarkovDesktop: { serviceRequest } })
  })
  afterEach(() => {
    cleanup()
    serviceRequest.mockReset()
    vi.unstubAllGlobals()
    delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
  })

  it('shows who saw them, with the button «Видел», and the reporters in the popover', async () => {
    const reportedAt = new Date(Date.now() - 4 * 60_000).toISOString()
    serviceRequest.mockResolvedValue({ latest: { mapId: 'customs', reportedAt, nickname: 'Bober' }, last5h: [{ mapId: 'customs', count: 2, lastAt: reportedAt }],
      recent: [{ mapId: 'customs', reportedAt, nickname: 'Bober' }, { mapId: 'customs', reportedAt, nickname: 'SHAURMA' }] })
    render(<LocaleProvider><GoonCard mode="pvp" mapName={(id) => MAPS[id] ?? id} /></LocaleProvider>)
    expect(screen.getByRole('button', { name: 'Видел' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/видел Bober/)).toBeInTheDocument())
    expect(screen.getAllByText('Таможня').length).toBeGreaterThan(0)
    expect(screen.getByText('SHAURMA')).toBeInTheDocument()
  })

  it('lists every reporter the server sends; the wheel over the statistics scrolls that list by rows, not the page', async () => {
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
    const recent = Array.from({ length: 9 }, (_, index) => ({ mapId: 'shoreline', reportedAt: at(index + 1), nickname: `Player_${index + 1}` }))
    serviceRequest.mockResolvedValue({ latest: recent[0], last5h: [{ mapId: 'shoreline', count: 9, lastAt: recent[0]!.reportedAt }], recent })
    const { container } = render(<LocaleProvider><GoonCard mode="pvp" mapName={(id) => MAPS[id] ?? id} /></LocaleProvider>)
    await waitFor(() => expect(screen.getByText('Player_9')).toBeInTheDocument())
    // jsdom lays nothing out: nine rows of 14 px, two of them visible
    const list = container.querySelector('.goon-recent') as HTMLElement
    let top = 0
    Object.defineProperties(list, { scrollHeight: { value: 126 }, clientHeight: { value: 28 }, scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(98, value)) } } })
    list.querySelectorAll('li').forEach((row, index) => Object.defineProperty(row, 'offsetTop', { value: index * 14 }))
    const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })
    container.querySelector('.goon-stats-popover')!.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(top).toBe(28)
  })

  it('says the nickname comes from the game logs when the account has none yet', async () => {
    serviceRequest.mockImplementation(async (method: string) => method === 'GET' ? { latest: null, last5h: [], recent: [] } : { accepted: false, reason: 'nickname' })
    render(<LocaleProvider><GoonCard mode="pvp" mapName={(id) => MAPS[id] ?? id} /></LocaleProvider>)
    await waitFor(() => expect(serviceRequest).toHaveBeenCalledWith('GET', '/v1/goons/pvp', undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Видел' }))
    fireEvent.click(screen.getByRole('button', { name: 'Лес' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' })) })
    await waitFor(() => expect(screen.getByText('Ник появится, когда приложение прочитает логи игры')).toBeInTheDocument())
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/goons/pvp/sightings', { mapId: 'woods' })
  })
})
