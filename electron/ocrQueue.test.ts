import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AFTER_HOLD_MS, backgroundScansHeld, holdBackgroundScans, holdBackgroundScansFor, runOcrJob } from './ocrQueue'

/** A reading that lasts `ms` and notes when it ran. */
const reading = (log: string[], name: string, ms = 5) => async () => {
  log.push(`${name}:start`)
  await new Promise((resolve) => setTimeout(resolve, ms))
  log.push(`${name}:end`)
  return name
}

describe('OCR across the app', () => {
  it('runs one reading at a time, whichever engine it is for', async () => {
    let active = 0
    let peak = 0
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => runOcrJob(async () => {
      peak = Math.max(peak, ++active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return index
    }, index % 2 ? 'interactive' : 'background')))
    expect(results).toEqual([0, 1, 2, 3, 4, 5])
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

  it('puts a reading the player waits for before the background ones waiting, never cutting one short', async () => {
    const log: string[] = []
    await Promise.all([
      runOcrJob(reading(log, 'scan-1')),
      runOcrJob(reading(log, 'scan-2')),
      runOcrJob(reading(log, 'tooltip'), 'interactive'),
    ])
    expect(log).toEqual(['scan-1:start', 'scan-1:end', 'tooltip:start', 'tooltip:end', 'scan-2:start', 'scan-2:end'])
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
