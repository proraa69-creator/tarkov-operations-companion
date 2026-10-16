import { describe, expect, it } from 'vitest'
import { restartingStatus, retriesWhileRestarting, retryWhileRestarting, SEND_RETRY_DELAYS_MS } from './sendRetry'

class NotTaken extends Error {}

describe('sending again while the server restarts', () => {
  it('only the bug report / idea and the support messages, only POST', () => {
    expect(retriesWhileRestarting('POST', '/v1/bug-reports')).toBe(true)
    expect(retriesWhileRestarting('POST', '/v1/me/support/messages')).toBe(true)
    expect(retriesWhileRestarting('POST', '/v1/accounts/me/admin/support/threads/0123456789abcdef01234567/messages')).toBe(true)
    expect(retriesWhileRestarting('GET', '/v1/me/support/messages')).toBe(false)
    expect(retriesWhileRestarting('POST', '/v1/me/support/read')).toBe(false)
    expect(retriesWhileRestarting('POST', '/v1/accounts/me/eft-account')).toBe(false)
  })

  it('the proxy\'s answers in front of a stopped server', () => {
    expect([502, 503, 504].every(restartingStatus)).toBe(true)
    expect([200, 400, 401, 404, 500].some(restartingStatus)).toBe(false)
  })

  it('tries again after each wait until the server takes it', async () => {
    const waits: number[] = []
    let calls = 0
    const result = await retryWhileRestarting(async () => {
      calls += 1
      if (calls < 3) throw new NotTaken()
      return 'sent'
    }, (error) => error instanceof NotTaken, SEND_RETRY_DELAYS_MS, async (ms) => { waits.push(ms) })
    expect(result).toBe('sent')
    expect(calls).toBe(3)
    expect(waits).toEqual(SEND_RETRY_DELAYS_MS.slice(0, 2))
  })

  it('gives up after the last wait with the error, about 40 s in all', async () => {
    let calls = 0
    const attempt = retryWhileRestarting(async () => { calls += 1; throw new NotTaken() }, (error) => error instanceof NotTaken, SEND_RETRY_DELAYS_MS, async () => {})
    await expect(attempt).rejects.toBeInstanceOf(NotTaken)
    expect(calls).toBe(SEND_RETRY_DELAYS_MS.length + 1)
    expect(SEND_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0)).toBe(40_000)
  })

  it('never sends twice what the server may have taken (a timeout, a refusal)', async () => {
    let calls = 0
    const attempt = retryWhileRestarting(async () => { calls += 1; throw new Error('timeout') }, (error) => error instanceof NotTaken, SEND_RETRY_DELAYS_MS, async () => {})
    await expect(attempt).rejects.toThrow('timeout')
    expect(calls).toBe(1)
  })
})
