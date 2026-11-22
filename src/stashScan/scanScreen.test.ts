import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScreenSyncTargets } from './screenSync'
import { scanScreen, SCAN_MAX_MS, SCAN_WINDOW_MS } from './useScreenSync'

const targets = {} as ScreenSyncTargets
/** A pass that read `read` labels new on screen. */
const pass = (read: number) => ({ ok: true as const, gameWindow: true, waiting: false, read, pending: 0, kappaAdded: [], hideoutAdded: 0, questsAdded: 0 })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** Runs a scan whose passes read what `reads(elapsed)` says; answers when it stopped, ms after the press. */
async function scanLength(reads: (elapsed: number) => number) {
  const started = Date.now()
  let stopped = -1
  void scanScreen(targets, { button: 'Сканировать', running: () => true, onMessage: () => {} }, { pass: async () => pass(reads(Date.now() - started)) })
    .then(() => { stopped = Date.now() - started })
  for (let step = 0; step < 1000 && stopped < 0; step += 1) await vi.advanceTimersByTimeAsync(500)
  return stopped
}

// Owner, 19.11.2026: containers are opened one after another, one over another — the scan goes on while they bring labels.
describe('one press of the stash scan', () => {
  it('stops SCAN_WINDOW_MS after the press when nothing new comes on screen', async () => {
    const stopped = await scanLength(() => 0)
    expect(stopped).toBeGreaterThanOrEqual(SCAN_WINDOW_MS)
    expect(stopped).toBeLessThan(SCAN_WINDOW_MS + 2000)
  })

  it('goes on SCAN_WINDOW_MS after the last labels new on screen (a container opened later)', async () => {
    const stopped = await scanLength((elapsed) => (elapsed < 2000 || (elapsed >= 40_000 && elapsed < 42_000) ? 5 : 0))
    expect(stopped).toBeGreaterThanOrEqual(40_000 + SCAN_WINDOW_MS)
    expect(stopped).toBeLessThan(42_000 + SCAN_WINDOW_MS + 2000)
  })

  it('stops after SCAN_MAX_MS whatever keeps coming', async () => {
    const stopped = await scanLength(() => 3)
    expect(stopped).toBeGreaterThanOrEqual(SCAN_MAX_MS)
    expect(stopped).toBeLessThan(SCAN_MAX_MS + 2000)
  })
})
