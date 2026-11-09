import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
vi.mock('./config', () => ({ API_URL: 'https://api.test' }))

const { captureAdVisit } = await import('./adVisit')
const { loadAdMark, saveAdMark } = await import('./storage')
const { api } = await import('./api')

const DAY = 24 * 60 * 60 * 1000

describe('«Реклама»: the site opened from an ad link', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    request.mockReset()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      request(url, init.body ? JSON.parse(String(init.body)) : undefined)
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('keeps the label, tells the server once per tab session, ignores other platforms', async () => {
    const send = vi.fn(async () => ({ ok: true }))
    expect(captureAdVisit('?utm_source=Reddit&utm_campaign=Tarkov%20Wipe', send)).toEqual({ source: 'reddit', campaign: 'tarkov-wipe' })
    await vi.waitFor(() => expect(sessionStorage.getItem('toc.visit.ad.reddit')).toBe('1'))
    expect(send).toHaveBeenCalledTimes(1)
    captureAdVisit('?utm_source=reddit&utm_campaign=tarkov-wipe', send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(loadAdMark()).toEqual({ source: 'reddit', campaign: 'tarkov-wipe' })

    expect(captureAdVisit('?utm_source=facebook', send)).toBeUndefined()
    expect(captureAdVisit('', send)).toBeUndefined()
    expect(send).toHaveBeenCalledTimes(1)
    expect(loadAdMark()).toEqual({ source: 'reddit', campaign: 'tarkov-wipe' })
  })

  it("counts an ad that leads to the bare address by Reddit's own click id, never sending the id", async () => {
    const send = vi.fn(async () => ({ ok: true }))
    expect(captureAdVisit('?rdt_cid=1234567890_abcdef', send)).toEqual({ source: 'reddit' })
    await vi.waitFor(() => expect(sessionStorage.getItem('toc.visit.ad.reddit')).toBe('1'))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ source: 'reddit' })
    expect(localStorage.getItem('toc.ad')).not.toContain('1234567890')
    // The same tab again: the label is kept, the server is not asked twice.
    expect(captureAdVisit('?utm_campaign=Wipe&rdt_cid=x', send)).toEqual({ source: 'reddit', campaign: 'wipe' })
    expect(captureAdVisit('?utm_source=reddit&utm_campaign=launch&rdt_cid=x', send)).toEqual({ source: 'reddit', campaign: 'launch' })
    expect(captureAdVisit('?rdt_cid=', send)).toBeUndefined()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('the default sender posts the visit to /ad-visits', async () => {
    captureAdVisit('?utm_source=reddit')
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('https://api.test/v1/accounts/ad-visits', { source: 'reddit' }))
  })

  it('sends the label with the registration within 7 days and forgets it then', async () => {
    const now = Date.now()
    saveAdMark({ source: 'reddit', campaign: 'launch' }, now - 6 * DAY)
    await api.register('new@example.com', 'correct horse battery', undefined, 'US')
    expect(request).toHaveBeenLastCalledWith('https://api.test/v1/accounts/register', { email: 'new@example.com', password: 'correct horse battery', country: 'US', adSource: 'reddit', adCampaign: 'launch' })
    expect(loadAdMark()).toBeUndefined()

    saveAdMark({ source: 'reddit' }, now - 8 * DAY)
    expect(loadAdMark()).toBeUndefined()
    await api.register('late@example.com', 'correct horse battery', undefined, 'US')
    expect(request).toHaveBeenLastCalledWith('https://api.test/v1/accounts/register', { email: 'late@example.com', password: 'correct horse battery', country: 'US' })
  })
})
