import { describe, expect, it } from 'vitest'
import { runOcrJob } from './ocrQueue'

describe('OCR worker queue', () => {
  it('serializes jobs on each worker without blocking other workers', async () => {
    const workers = [{}, {}]
    const active = new Map<object, number>()
    let peak = 0
    let total = 0
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => {
      const worker = workers[index % 2]!
      return runOcrJob(worker, async () => {
        expect(active.get(worker) ?? 0).toBe(0)
        active.set(worker, 1)
        peak = Math.max(peak, ++total)
        await new Promise((resolve) => setTimeout(resolve, 2))
        --total
        active.set(worker, 0)
        return index
      })
    }))
    expect(results).toEqual([0, 1, 2, 3, 4, 5])
    expect(peak).toBe(2)
  })
  it('reports a failed reading and allows the next scan to proceed', async () => {
    const worker = {}
    const failed = runOcrJob(worker, async () => { throw new Error('OCR failed') })
    const next = runOcrJob(worker, async () => 'recovered')
    await expect(failed).rejects.toThrow('OCR failed')
    await expect(next).resolves.toBe('recovered')
  })
})
