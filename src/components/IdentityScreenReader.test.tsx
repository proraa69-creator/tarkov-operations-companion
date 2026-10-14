import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORY_SCAN_TIMING } from '../import/storyScanTiming'

const kept = vi.hoisted(() => ({ modeSelect: [] as unknown[][], trader: [] as unknown[][] }))
vi.mock('../account/logNickname', () => ({
  keepModeSelectScreen: (...args: unknown[]) => { kept.modeSelect.push(args) },
  keepTraderScreen: (...args: unknown[]) => { kept.trader.push(args) },
}))
const { IdentityScreenReader } = await import('./IdentityScreenReader')

type Frame = Awaited<ReturnType<NonNullable<NonNullable<Window['tarkovDesktop']>['captureIdentityFrame']>>>
let calls = 0
function desktop(frames: Frame[], inRaid = false) {
  calls = 0
  window.tarkovDesktop = {
    captureIdentityFrame: vi.fn(async () => frames[Math.min(calls++, frames.length - 1)]!),
    getRaidState: async () => ({ inRaid }),
    onRaidStateChanged: () => () => {},
  } as unknown as NonNullable<Window['tarkovDesktop']>
}
const run = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => { vi.useFakeTimers(); kept.modeSelect = []; kept.trader = [] })
afterEach(() => { cleanup(); vi.useRealTimers(); Reflect.deleteProperty(window, 'tarkovDesktop') })

describe('the locked app\'s identity reader (audit P4a)', () => {
  const cards = [{ mode: 'pve' as const, nickname: 'Raid_OS', level: 41 }]

  it('keeps the mode selection read right after a new game window, and nothing else', async () => {
    desktop([{ text: 'SELECT PROFILE AND MODE', sourceName: 'EscapeFromTarkov', gameWindow: true, freshGame: true, observedAt: 1000, profiles: cards }])
    render(<IdentityScreenReader />)
    await run(0)
    expect(kept.modeSelect).toEqual([[cards, 1000]])
    // The quick pace of a game start.
    await run(STORY_SCAN_TIMING.menuMs)
    expect(calls).toBe(2)
  })

  it('outside a game start nothing is copied: it only asks again whether a new game window came', async () => {
    desktop([{ text: '', sourceName: '', gameWindow: true, freshGame: false, gameSince: 5 }])
    render(<IdentityScreenReader />)
    await run(0)
    await run(STORY_SCAN_TIMING.idleMs)
    expect(calls).toBe(2)
    expect(kept.modeSelect).toEqual([])
    expect(kept.trader).toEqual([])
  })

  it('keeps the traders\' screen with the game\'s mode only when the logs named it', async () => {
    const trader = { nickname: 'Raid_OS' }
    desktop([{ text: '', sourceName: 'EscapeFromTarkov', gameWindow: true, freshGame: true, observedAt: 2000, trader }])
    render(<IdentityScreenReader />)
    await run(0)
    expect(kept.trader).toEqual([[trader, undefined, 2000]])
  })

  it('never looks during a raid the logs report', async () => {
    desktop([{ text: 'SELECT PROFILE AND MODE', sourceName: 'EscapeFromTarkov', gameWindow: true, freshGame: true, profiles: cards }], true)
    render(<IdentityScreenReader />)
    await run(0)
    await run(STORY_SCAN_TIMING.idleMs * 3)
    expect(calls).toBe(0)
  })

  it('does nothing outside the desktop app', async () => {
    render(<IdentityScreenReader />)
    await run(STORY_SCAN_TIMING.idleMs * 2)
    expect(kept.modeSelect).toEqual([])
  })
})
