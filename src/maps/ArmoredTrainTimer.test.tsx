import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RaidState } from '../import/raidState'
import { ArmoredTrainBanner, ArmoredTrainNotifier, ArmoredTrainSetting } from './ArmoredTrainTimer'
import { ARMORED_TRAINS, setArmoredTrainNoticeOn, setArmoredTrainOn } from './armoredTrain'

type Desktop = NonNullable<Window['tarkovDesktop']>
const HINT = 'Прибывает через 26–30 мин после начала рейда, стоит 6 мин 30 с'

function mockRaid(raid: RaidState) {
  window.tarkovDesktop = {
    getRaidState: async () => raid,
    onRaidStateChanged: () => () => {},
  } as unknown as Desktop
}

afterEach(() => {
  setArmoredTrainOn(false)
  setArmoredTrainNoticeOn(false)
  delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
  try { localStorage.clear() } catch { /* storage unavailable */ }
})

describe('«Таймер бронепоезда»', () => {
  it('two switches on Reserve and Lighthouse only, and the icon shows once the timer is on', () => {
    const { rerender } = render(<><ArmoredTrainSetting mapId="customs" /><ArmoredTrainBanner mapId="customs" /></>)
    expect(screen.queryByRole('switch')).toBeNull()
    rerender(<><ArmoredTrainSetting mapId="reserve" /><ArmoredTrainBanner mapId="reserve" /></>)
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Таймер бронепоезда' }))
    expect(screen.getByRole('status')).toHaveAttribute('title', HINT)
  })

  it('keeps the «Уведомления о прибытии» switch', () => {
    render(<ArmoredTrainSetting mapId="lighthouse" />)
    const notice = screen.getByRole('switch', { name: 'Уведомления о прибытии' })
    expect(notice).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(notice)
    expect(screen.getByRole('switch', { name: 'Уведомления о прибытии' })).toHaveAttribute('aria-checked', 'true')
  })

  it('counts down to the arrival in a PMC\'s raid on this map', async () => {
    const begun = Date.now() - 600_000
    mockRaid({ inRaid: true, since: begun - 60_000, begun, location: 'RezervBase', side: 'pmc', tracked: true })
    setArmoredTrainOn(true)
    render(<ArmoredTrainBanner mapId="reserve" />)
    await act(async () => { await Promise.resolve() })
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/^15:[34]\d$/)
    expect(status.getAttribute('title')).toMatch(/^Бронепоезд прибудет через 15:[34]\d–19:[45]\d$/)
  })

  // Owner, 25.11.2026: a Scav joins a raid already running — no live countdown, only the general hint.
  it('shows the hint, not a countdown, for a Scav', async () => {
    const begun = Date.now() - 600_000
    mockRaid({ inRaid: true, since: begun - 60_000, begun, location: 'RezervBase', side: 'savage', tracked: true })
    setArmoredTrainOn(true)
    render(<ArmoredTrainBanner mapId="reserve" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('status')).toHaveAttribute('title', HINT)
  })

  it('shows the hint, not a countdown, when the side is unknown', async () => {
    const begun = Date.now() - 600_000
    mockRaid({ inRaid: true, since: begun - 60_000, begun, location: 'RezervBase', tracked: true })
    setArmoredTrainOn(true)
    render(<ArmoredTrainBanner mapId="reserve" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('status')).toHaveAttribute('title', HINT)
  })

  it('the icon goes once the arrival window is over', async () => {
    const begun = Date.now() - 2_000_000
    mockRaid({ inRaid: true, since: begun - 60_000, begun, location: 'RezervBase', side: 'pmc', tracked: true })
    setArmoredTrainOn(true)
    render(<ArmoredTrainBanner mapId="reserve" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('«Бронепоезд прибывает» (the arrival notice)', () => {
  const arriving = () => Date.now() - (ARMORED_TRAINS.reserve.arriveMin + 10) * 1000

  it('comes for a PMC when the arrival window opens, with «Уведомления о прибытии» on', async () => {
    setArmoredTrainNoticeOn(true)
    const begun = arriving()
    mockRaid({ inRaid: true, since: begun - 60_000, begun, location: 'RezervBase', side: 'pmc', tracked: true })
    render(<ArmoredTrainNotifier />)
    await waitFor(() => expect(screen.getByText('Бронепоезд прибывает')).toBeInTheDocument())
  })

  it('says nothing with the switch off', async () => {
    const begun = arriving()
    mockRaid({ inRaid: true, since: begun - 60_000, begun, location: 'RezervBase', side: 'pmc', tracked: true })
    render(<ArmoredTrainNotifier />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText('Бронепоезд прибывает')).toBeNull()
  })

  it('says nothing for a Scav even with the switch on', async () => {
    setArmoredTrainNoticeOn(true)
    const begun = arriving()
    mockRaid({ inRaid: true, since: begun - 60_000, begun, location: 'RezervBase', side: 'savage', tracked: true })
    render(<ArmoredTrainNotifier />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText('Бронепоезд прибывает')).toBeNull()
  })
})
