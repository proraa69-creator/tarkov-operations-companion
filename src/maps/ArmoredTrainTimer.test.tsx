import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ArmoredTrainBanner, ArmoredTrainSetting } from './ArmoredTrainTimer'
import { setArmoredTrainOn } from './armoredTrain'

type Desktop = NonNullable<Window['tarkovDesktop']>

afterEach(() => {
  setArmoredTrainOn(false)
  delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
})

describe('«Таймер бронепоезда»', () => {
  it('is a switch in the map settings on Reserve and Lighthouse only, and the line shows once it is on', () => {
    const { rerender } = render(<><ArmoredTrainSetting mapId="customs" /><ArmoredTrainBanner mapId="customs" /></>)
    expect(screen.queryByRole('switch')).toBeNull()
    rerender(<><ArmoredTrainSetting mapId="reserve" /><ArmoredTrainBanner mapId="reserve" /></>)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Таймер бронепоезда' }))
    expect(screen.getByRole('status').textContent).toBe('Бронепоезд прибывает через 26–30\u00a0мин после начала рейда, стоит 7\u00a0мин')
  })

  it('counts down in a raid on this map', async () => {
    const begun = Date.now() - 600_000
    window.tarkovDesktop = {
      getRaidState: async () => ({ inRaid: true, since: begun - 60_000, begun, location: 'RezervBase', tracked: true }),
      onRaidStateChanged: () => () => {},
    } as unknown as Desktop
    setArmoredTrainOn(true)
    render(<ArmoredTrainBanner mapId="reserve" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('status').textContent).toMatch(/^Бронепоезд прибудет через 15:4\d–19:5\d$/)
  })
})
