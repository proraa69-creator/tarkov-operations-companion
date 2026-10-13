import { describe, expect, it, vi } from 'vitest'
import { watchMapUpdates } from './mapUpdates'

describe('live map updates', () => {
  it('asks with the last version and reports every change, not the first answer', async () => {
    const stop = new AbortController()
    const answers = [{ version: 5 }, { version: 5 }, { version: 6 }, { version: 9 }]
    const paths: string[] = []
    const request = vi.fn(async (_method: string, path: string) => {
      paths.push(path)
      const next = answers.shift()
      if (!next) { stop.abort(); return { version: 9 } }
      return next
    })
    const changed = vi.fn()
    await watchMapUpdates(request, changed, stop.signal, 1)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(paths.slice(0, 4)).toEqual(['/v1/map-updates', '/v1/map-updates?since=5', '/v1/map-updates?since=5', '/v1/map-updates?since=6'])
  })

  it('pauses before asking again when an unchanged version comes back at once (a full waiting room)', async () => {
    vi.useFakeTimers()
    try {
      const stop = new AbortController()
      const request = vi.fn(async () => ({ version: 5 }))
      const done = watchMapUpdates(request, vi.fn(), stop.signal, 30_000)
      await vi.advanceTimersByTimeAsync(0)
      expect(request).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(4_900)
      expect(request).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(200)
      expect(request).toHaveBeenCalledTimes(3)
      stop.abort()
      await vi.advanceTimersByTimeAsync(10_000)
      await done
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits and tries again when the server has no such route', async () => {
    const stop = new AbortController()
    let calls = 0
    const request = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('Сервис недоступен: 404')
      if (calls === 2) return { version: 1 }
      stop.abort()
      return { version: 2 }
    })
    const changed = vi.fn()
    await watchMapUpdates(request, changed, stop.signal, 1)
    expect(calls).toBe(3)
    expect(changed).not.toHaveBeenCalled()
  })
})
