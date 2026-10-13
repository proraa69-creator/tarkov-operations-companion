import { describe, expect, it, vi } from 'vitest'
import { cachedProfileLookup, fetchOwnProfile, FOUND_TTL_MS, MISSING_TTL_MS, ownProfileUrl, type JsonFetch } from './ownProfileLookup.js'

/** Cloudflare refuses our VPS on players.tarkov.dev (owner, 13.10.2026): the own profile is asked from the player's PC. */
const profile = (aid: number, nickname = 'Bear_Hunter') => ({ aid, info: { nickname, side: 'Bear', experience: 1_250_000, memberCategory: 2, prestigeLevel: 1 }, updated: Date.parse('2026-10-13T12:00:00Z') })
const answer = (status: number, body: unknown = {}): JsonFetch => vi.fn(async () => ({ status, json: async () => body }))

describe('the own Tarkov.dev profile from this PC', () => {
  it('asks the profile of the mode and reads the nickname and level', async () => {
    expect(ownProfileUrl('pvp', 5550123)).toBe('https://players.tarkov.dev/profile/5550123.json')
    expect(ownProfileUrl('pve', 5550123)).toBe('https://players.tarkov.dev/pve/5550123.json')
    expect(ownProfileUrl('seasonal', 5550123)).toBe('https://players.tarkov.dev/pvp-season/5550123.json')
    const fetcher = answer(200, profile(5550123))
    const snapshot = await fetchOwnProfile('pve', 5550123, fetcher)
    expect(fetcher).toHaveBeenCalledWith('https://players.tarkov.dev/pve/5550123.json')
    expect(snapshot).toMatchObject({ accountId: 5550123, nickname: 'Bear_Hunter', faction: 'bear', prestige: 1, accountType: 'EOD', upstreamUpdatedAt: '2026-10-13T12:00:00.000Z' })
    expect(snapshot!.level).toBeGreaterThan(1)
  })

  it('answers null for a profile not published, a refusal, another account, broken data or no network', async () => {
    for (const status of [404, 403, 429, 500]) expect(await fetchOwnProfile('pvp', 1, answer(status)), String(status)).toBeNull()
    expect(await fetchOwnProfile('pvp', 1, answer(200, profile(2)))).toBeNull()
    expect(await fetchOwnProfile('pvp', 1, answer(200, { aid: 1 }))).toBeNull()
    expect(await fetchOwnProfile('pvp', 1, async () => { throw new Error('offline') })).toBeNull()
    const never = answer(200, profile(1))
    expect(await fetchOwnProfile('pvp', 0, never)).toBeNull()
    expect(never).not.toHaveBeenCalled()
  })

  it('asks Tarkov.dev again only after a while: 10 minutes for a found profile, 2 for a missing one', async () => {
    let time = 0
    let status = 404
    const fetcher = vi.fn(async () => ({ status, json: async () => profile(7) }))
    const lookup = cachedProfileLookup(fetcher, () => time)
    expect(await lookup('pvp', 7)).toBeNull()
    expect(await lookup('pvp', 7)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    time += MISSING_TTL_MS
    status = 200
    expect(await lookup('pvp', 7)).toMatchObject({ nickname: 'Bear_Hunter' })
    time += FOUND_TTL_MS - 1
    await lookup('pvp', 7)
    expect(fetcher).toHaveBeenCalledTimes(2)
    // Another mode is another profile.
    await lookup('pve', 7)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
