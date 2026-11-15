import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataProvider } from '../data/DataProvider'
import { demoDataset } from '../data/demo'
import { LocaleProvider } from '../i18n/LocaleProvider'
import type { RaidState } from '../import/raidState'
import { AppStateProvider } from '../state/AppState'
import { RaidStartNotifier } from './RaidStartNotifier'
import { RAID_START_FRESH_MS, raidStartNoticeOn, setRaidStartNotice, takeRaidStart } from './raidStartNotice'

const listeners = new Set<(state: RaidState) => void>()
const push = (state: RaidState) => { for (const listener of listeners) listener(state) }
const notify = vi.fn(async () => true)

/** Mounted and listening to the raid state (the providers settle first). */
async function mounted() {
  await waitFor(() => expect(listeners.size).toBeGreaterThan(0))
  return push
}

function renderNotifier() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], demoDataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter><RaidStartNotifier /></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  listeners.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  notify.mockClear()
  window.tarkovDesktop = {
    getRaidState: async () => ({ inRaid: false, tracked: true }),
    onRaidStateChanged: (callback: (state: RaidState) => void) => { listeners.add(callback); return () => { listeners.delete(callback) } },
    notify,
  } as unknown as NonNullable<Window['tarkovDesktop']>
})
afterEach(() => { delete window.tarkovDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

// Owner, 15.11.2026: «ждет, пока у него идет загрузка. Как только рейд начинается, должно всплывать уведомление… маленькое сбоку».
describe('«Рейд начался»', () => {
  it('once per raid, while it is fresh, and not with the switch off', () => {
    const now = Date.parse('2026-11-15T12:00:00Z')
    expect(raidStartNoticeOn()).toBe(true)
    expect(takeRaidStart(undefined, now)).toBe(false)
    expect(takeRaidStart(now - 5000, now)).toBe(true)
    expect(takeRaidStart(now - 5000, now)).toBe(false)
    expect(takeRaidStart(now - RAID_START_FRESH_MS - 1000, now)).toBe(false)
    setRaidStartNotice(false)
    expect(takeRaidStart(now - 1000, now)).toBe(false)
    setRaidStartNotice(true)
    expect(takeRaidStart(now - 1000, now)).toBe(true)
  })

  it('the loading says nothing; the raid beginning shows the card with its map and a Windows notification', async () => {
    renderNotifier()
    const send = await mounted()
    await act(async () => { send({ inRaid: true, since: Date.now() - 60_000, location: 'bigmap', tracked: true }) })
    expect(screen.queryByText('Рейд начался')).toBeNull()
    await act(async () => { send({ inRaid: true, since: Date.now() - 60_000, begun: Date.now() - 1000, location: 'bigmap', tracked: true }) })
    expect(screen.getByRole('status')).toHaveTextContent('Рейд начался')
    expect(screen.getByRole('status')).toHaveTextContent('Таможня')
    expect(notify).toHaveBeenCalledWith('Рейд начался', 'Таможня')
    expect(JSON.parse(localStorage.getItem('raidos-notifications-v1') ?? '[]')[0]).toMatchObject({ title: 'Рейд начался' })
  })

  it('says nothing with the switch off', async () => {
    setRaidStartNotice(false)
    renderNotifier()
    const send = await mounted()
    await act(async () => { send({ inRaid: true, since: Date.now() - 60_000, begun: Date.now() - 1000, location: 'bigmap', tracked: true }) })
    expect(screen.queryByText('Рейд начался')).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })
})
