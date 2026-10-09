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

  it('asks for a nickname when the account has none for this mode', async () => {
    serviceRequest.mockImplementation(async (method: string) => method === 'GET' ? { latest: null, last5h: [], recent: [] } : { accepted: false, reason: 'nickname' })
    render(<LocaleProvider><GoonCard mode="pvp" mapName={(id) => MAPS[id] ?? id} /></LocaleProvider>)
    await waitFor(() => expect(serviceRequest).toHaveBeenCalledWith('GET', '/v1/goons/pvp', undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Видел' }))
    fireEvent.click(screen.getByRole('button', { name: 'Лес' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' })) })
    await waitFor(() => expect(screen.getByText('Укажите ник Таркова в профиле')).toBeInTheDocument())
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/goons/pvp/sightings', { mapId: 'woods' })
  })
})
