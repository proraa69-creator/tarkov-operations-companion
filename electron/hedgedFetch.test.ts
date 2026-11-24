// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { hedgedFetch, warmConnection } from './hedgedFetch'

/**
 * Owner, 15.11.2026: «связь с сервером не должна обрываться». A new connection from his PC to raidos.app took ~20 s in two
 * tries of three; a fresh connection is a fresh chance, so a read that has no answer goes again on another one.
 */
type Try = { signal: AbortSignal; answer: (response: Response) => void; fail: (error: unknown) => void }

function fakeNetwork() {
  const tries: Try[] = []
  const fetcher = ((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init.signal!
    const entry: Try = { signal, answer: resolve, fail: reject }
    tries.push(entry)
    signal.addEventListener('abort', () => reject(signal.reason))
  })) as unknown as typeof fetch
  return { tries, fetcher }
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('hedgedFetch', () => {
  it('a read with no answer goes again on a new connection; the first answer wins and the others are dropped', async () => {
    const { tries, fetcher } = fakeNetwork()
    const result = hedgedFetch('https://raidos.app/health', { method: 'GET', signal: AbortSignal.timeout(5_000) }, { hedgeMs: 20, attempts: 4, fetcher })
    expect(tries).toHaveLength(1)
    await wait(30)
    expect(tries).toHaveLength(2)
    tries[1]!.answer(new Response('ok'))
    expect(await (await result).text()).toBe('ok')
    expect(tries[0]!.signal.aborted).toBe(true)
    await wait(60)
    // no more tries once answered
    expect(tries).toHaveLength(2)
  })

  it('sends at most `attempts` tries, then waits for one of them', async () => {
    const { tries, fetcher } = fakeNetwork()
    const result = hedgedFetch('https://raidos.app/health', { method: 'GET', signal: AbortSignal.timeout(5_000) }, { hedgeMs: 10, attempts: 3, fetcher })
    await wait(80)
    expect(tries).toHaveLength(3)
    tries[0]!.answer(new Response('first'))
    expect(await (await result).text()).toBe('first')
  })

  it('a try that fails at once is followed by the next one at once; when all fail, the request fails', async () => {
    let calls = 0
    const fetcher = (() => { calls += 1; return Promise.reject(new TypeError('fetch failed')) }) as unknown as typeof fetch
    await expect(hedgedFetch('https://raidos.app/health', { method: 'GET', signal: AbortSignal.timeout(5_000) }, { hedgeMs: 1_000, attempts: 3, fetcher })).rejects.toThrow('fetch failed')
    expect(calls).toBe(3)
  })

  it('the caller\'s time limit ends every try', async () => {
    const { tries, fetcher } = fakeNetwork()
    await expect(hedgedFetch('https://raidos.app/health', { method: 'GET', signal: AbortSignal.timeout(50) }, { hedgeMs: 20, attempts: 4, fetcher })).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(tries.length).toBeGreaterThan(1)
    expect(tries.every((entry) => entry.signal.aborted)).toBe(true)
  })

  it('warmConnection reads /health to the end and never throws', async () => {
    const seen: string[] = []
    const ok = (async (url: string) => { seen.push(url); return new Response('{"ok":true}') }) as unknown as typeof fetch
    expect(await warmConnection('https://raidos.app', { fetcher: ok })).toBe(true)
    expect(seen).toEqual(['https://raidos.app/health'])
    const down = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch
    expect(await warmConnection('https://raidos.app', { fetcher: down, attempts: 2 })).toBe(false)
  })
})
