import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPlayerProfileCache, fetchPlayerProfile, resolveAccountIdsByNickname, resolvePlayerByNickname } from './playerProfileService'

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

  describe('binding a nickname', () => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    const levels = () => json({ data: { playerLevels: [{ level: 1, exp: 0 }] } })
    const profile = (aid: number, nickname: string) => json({ aid, info: { nickname, experience: 0, side: 'Usec' }, updated: 1790359091847 })

    it('takes the account from the game logs when its published profile has this nickname', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('json.tarkov.dev')) return levels()
        if (url.endsWith('/profile/77.json')) return profile(77, 'Raid_OS')
        throw new Error(`unexpected ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)
      const bound = await resolvePlayerByNickname('pvp', 'raid_os', 77)
      expect(bound).toMatchObject({ accountId: 77, nickname: 'Raid_OS', snapshot: { accountId: 77 } })
      expect(bound).not.toHaveProperty('pending')
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('index.json'))).toBe(false)
    })

    it('binds a new character found by the live search before tarkov.dev publishes its profile', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.startsWith('https://player.tarkov.dev/name/raid_os?gameMode=regular')) return json([{ aid: 501, name: 'Raid_OS' }, { aid: 502, name: 'Raid_OS2' }])
        if (url.includes('json.tarkov.dev')) return levels()
        if (url.endsWith('/profile/501.json')) return json({}, 404)
        throw new Error(`unexpected ${url}`)
      }))
      await expect(resolvePlayerByNickname('pvp', 'Raid_OS')).resolves.toEqual({ accountId: 501, nickname: 'Raid_OS', level: 0, faction: 'unknown', mode: 'pvp', pending: true })
    })

    it('binds a renamed character from the logs while tarkov.dev still shows the old nickname', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.includes('player.tarkov.dev/name/')) return json({ errmsg: 'Turnstile' }, 401)
        if (url.includes('/pve/index.json')) return json({ 9: 'Someone' })
        if (url.includes('json.tarkov.dev')) return levels()
        if (url.endsWith('/pve/88.json')) return profile(88, 'OldName')
        throw new Error(`unexpected ${url}`)
      }))
      await expect(resolvePlayerByNickname('pve', 'NewName', 88)).resolves.toMatchObject({ accountId: 88, nickname: 'NewName', pending: true })
    })

    it('falls back to the published index when the live search refuses, and says what to do when nothing knows the nickname', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('player.tarkov.dev/name/')) return json({}, 401)
        if (url.includes('/profile/index.json')) return json({ 5: 'Indexed', 6: 'Other' })
        if (url.includes('json.tarkov.dev')) return levels()
        if (url.endsWith('/profile/5.json')) return profile(5, 'Indexed')
        throw new Error(`unexpected ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)
      await expect(resolvePlayerByNickname('pvp', 'indexed')).resolves.toMatchObject({ accountId: 5, nickname: 'Indexed' })
      await expect(resolvePlayerByNickname('pvp', 'Nobody')).rejects.toThrow(/пока не найден\..*из логов игры/)
      // the ~70 MB index is not downloaded again for the second nickname right after the first
      expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('index.json'))).toHaveLength(1)
    })
  })
})
