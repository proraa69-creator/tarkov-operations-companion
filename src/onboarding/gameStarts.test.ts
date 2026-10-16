import { beforeEach, describe, expect, it } from 'vitest'
import { ALREADY_RUNNING_MS, GAME_RESTART_KEY, GAME_START_LIMIT, gameRestartNoticeDue, noteGameSighting, noteModeSelectRead } from './gameStarts'

const started = 1_000_000
const start = (since: number) => noteGameSighting({ freshGame: true, gameSince: since }, started)

beforeEach(() => localStorage.clear())

describe('the first-launch notice: until the mode selection is read or three game starts (audit P4f)', () => {
  it('is due on a computer that has seen neither', () => {
    expect(gameRestartNoticeDue()).toBe(true)
  })

  it('is no longer due once the mode selection screen was read', () => {
    noteModeSelectRead()
    expect(gameRestartNoticeDue()).toBe(false)
  })

  it('counts each new game window once, and stops after three starts without a reading', () => {
    const later = started + ALREADY_RUNNING_MS + 5_000
    for (let look = 0; look < 5; look += 1) start(later)
    expect(JSON.parse(localStorage.getItem(GAME_RESTART_KEY)!)).toMatchObject({ starts: 1 })
    start(later + 60_000)
    expect(gameRestartNoticeDue()).toBe(true)
    start(later + 120_000)
    expect(JSON.parse(localStorage.getItem(GAME_RESTART_KEY)!)).toMatchObject({ starts: GAME_START_LIMIT })
    expect(gameRestartNoticeDue()).toBe(false)
  })

  it('a game already running when the app started is no start the app saw; nor a window that is not new', () => {
    start(started + 2_000)
    noteGameSighting({ freshGame: false, gameSince: started + 60_000 }, started)
    noteGameSighting({ freshGame: true }, started)
    noteGameSighting(null, started)
    expect(localStorage.getItem(GAME_RESTART_KEY)).toBeNull()
  })

  it('an older window than the last counted one is not counted again (another app start, the same game)', () => {
    start(started + 30_000)
    start(started + 20_000)
    expect(JSON.parse(localStorage.getItem(GAME_RESTART_KEY)!)).toMatchObject({ starts: 1 })
  })
})
