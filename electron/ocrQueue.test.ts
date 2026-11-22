import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AFTER_HOLD_MS, backgroundScansHeld, holdBackgroundScans, holdBackgroundScansFor, isOcrTimeout, runOcrJob } from './ocrQueue'

/** A reading that lasts `ms` and notes when it ran. */
const reading = (log: string[], name: string, ms = 5) => async () => {
  log.push(`${name}:start`)
  await new Promise((resolve) => setTimeout(resolve, ms))
  log.push(`${name}:end`)
  return name
}

describe('OCR across the app', () => {
  it('runs one background and one interactive reading at a time at most', async () => {
    const active = { interactive: 0, background: 0 }
    const peak = { interactive: 0, background: 0, total: 0 }
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => {
      const priority = index % 2 ? 'interactive' : 'background'
      return runOcrJob(async () => {
        active[priority] += 1
        peak[priority] = Math.max(peak[priority], active[priority])
        peak.total = Math.max(peak.total, active.interactive + active.background)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active[priority] -= 1
        return index
      }, priority)
    }))
    expect(results).toEqual([0, 1, 2, 3, 4, 5])
    expect(peak).toEqual({ interactive: 1, background: 1, total: 2 })
  })

  it('runs background readings one at a time', async () => {
    let active = 0
    let peak = 0
    await Promise.all(Array.from({ length: 4 }, () => runOcrJob(async () => {
      peak = Math.max(peak, ++active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
    })))
    expect(peak).toBe(1)
  })

  it('reports a failed reading and allows the next scan to proceed', async () => {
    const failed = runOcrJob(async () => { throw new Error('OCR failed') })
    const thrown = runOcrJob(() => { throw new Error('not even started') })
    const next = runOcrJob(async () => 'recovered')
    await expect(failed).rejects.toThrow('OCR failed')
    await expect(thrown).rejects.toThrow('not even started')
    await expect(next).resolves.toBe('recovered')
  })

  it('gives up a reading that never ends, so the next one still runs', async () => {
    // A hung engine: its reading never settles (reports of 10.11.2026, the item key stopped for good).
    const hung = runOcrJob(() => new Promise<string>(() => {}), 'interactive', 30)
    const next = runOcrJob(async () => 'next card', 'interactive')
    const error = await hung.catch((reason: unknown) => reason)
    expect(isOcrTimeout(error)).toBe(true)
    await expect(next).resolves.toBe('next card')
  })

  it('puts a reading the player waits for before the background ones waiting, never cutting one short', async () => {
    const log: string[] = []
    await Promise.all([
      runOcrJob(reading(log, 'scan-1', 40)),
      runOcrJob(reading(log, 'scan-2')),
      runOcrJob(reading(log, 'tooltip'), 'interactive'),
    ])
    expect(log).toEqual(['scan-1:start', 'tooltip:start', 'tooltip:end', 'scan-1:end', 'scan-2:start', 'scan-2:end'])
  })
})

describe('the quest scanner holds off while the player waits', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('during an item lookup and a moment after it', async () => {
    const release = holdBackgroundScans()
    expect(backgroundScansHeld()).toBe(true)
    const log: string[] = []
    const scan = runOcrJob(reading(log, 'scan'))
    const tooltip = runOcrJob(reading(log, 'tooltip'), 'interactive')
    await vi.advanceTimersByTimeAsync(50)
    // The lookup's reading ran; the scanner's waits for the lookup to end.
    expect(log).toEqual(['tooltip:start', 'tooltip:end'])
    await tooltip
    release()
    release()
    expect(backgroundScansHeld()).toBe(true)
    await vi.advanceTimersByTimeAsync(AFTER_HOLD_MS - 100)
    expect(log).toEqual(['tooltip:start', 'tooltip:end'])
    await vi.advanceTimersByTimeAsync(200)
    expect(backgroundScansHeld()).toBe(false)
    await expect(scan).resolves.toBe('scan')
    expect(log.at(-1)).toBe('scan:end')
  })

  it('while a Kappa scan keeps coming back', async () => {
    holdBackgroundScansFor(3000)
    expect(backgroundScansHeld()).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    holdBackgroundScansFor(3000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(backgroundScansHeld()).toBe(true)
    await vi.advanceTimersByTimeAsync(1001)
    expect(backgroundScansHeld()).toBe(false)
  })
})

describe('an item lookup during a whole-screen pass of the quest scanner', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('reads the tooltip at once instead of waiting seconds for the pass to end', async () => {
    // Clear of the holds the tests above left behind.
    vi.setSystemTime(Date.now() + 60_000)
    const log: string[] = []
    // The pass started just before the key: ~6 s (measured 18.11.2026), a tooltip line ~0.1 s.
    const pass = runOcrJob(reading(log, 'pass', 6000))
    const release = holdBackgroundScans()
    const nextPass = runOcrJob(reading(log, 'next-pass', 6000))
    const started = Date.now()
    const lines = [runOcrJob(reading(log, 'line-1', 100), 'interactive'), runOcrJob(reading(log, 'line-2', 100), 'interactive')]
    await vi.advanceTimersByTimeAsync(200)
    await expect(Promise.all(lines)).resolves.toEqual(['line-1', 'line-2'])
    expect(Date.now() - started).toBeLessThanOrEqual(200)
    // The lookup's lines one after the other; the running pass goes on, no new one starts during the lookup.
    expect(log).toEqual(['pass:start', 'line-1:start', 'line-1:end', 'line-2:start', 'line-2:end'])
    await vi.advanceTimersByTimeAsync(6000)
    await expect(pass).resolves.toBe('pass')
    expect(log).not.toContain('next-pass:start')
    release()
    await vi.advanceTimersByTimeAsync(AFTER_HOLD_MS + 6100)
    await expect(nextPass).resolves.toBe('next-pass')
  })
})
