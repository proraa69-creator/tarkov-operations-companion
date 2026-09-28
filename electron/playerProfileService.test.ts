import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPlayerProfileCache, fetchPlayerProfile, resolveAccountIdsByNickname } from './playerProfileService'

afterEach(() => {
  clearPlayerProfileCache()
  vi.unstubAllGlobals()
})

describe('player profile service', () => {
  it('fetches and caches a normalized profile', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('json.tarkov.dev')) return new Response(JSON.stringify({ data: { playerLevels: [{ level: 1, exp: 0 }, { level: 2, exp: 1000 }] } }))
      return new Response(JSON.stringify({ aid: 7, info: { nickname: 'SHAURMA', experience: 1000, side: 'Bear' }, updated: 1790359091847 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const first = await fetchPlayerProfile('pvp', 7)
    const second = await fetchPlayerProfile('pvp', 7)
    expect(first).toMatchObject({ accountId: 7, nickname: 'SHAURMA', level: 2, faction: 'bear' })
    expect(second).toEqual(first)
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('players.tarkov.dev'))).toBe(true)
  })

  it('resolves seasonal nicknames from the mode index', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/pvp-season/index.json')) return new Response(JSON.stringify({ 42: 'SeasonNick', 99: 'Other' }))
      throw new Error(`unexpected ${url}`)
    }))
    await expect(resolveAccountIdsByNickname('seasonal', 'SeasonNick')).resolves.toEqual([42])
  })

  it('returns a clear rate-limit error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })))
    await expect(fetchPlayerProfile('pve', 7)).rejects.toThrow(/через минуту/)
  })
})
