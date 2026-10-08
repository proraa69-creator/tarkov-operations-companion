import { isMobileLayout, MOBILE_MAX_WIDTH } from './platform'
import { defaultTheme } from './theme/theme'
import { parseServerPosition, positionFreshness, POSITION_FRESH_MS } from './sync/serverSync'
import { normalizeApiUrl } from './sync/webAccount'

describe('platform gating', () => {
  it('uses the phone layout in the native app, never in the desktop shell, and in a browser only at phone width', () => {
    expect(isMobileLayout({ native: true, desktop: false, width: 1400 })).toBe(true)
    expect(isMobileLayout({ native: false, desktop: true, width: 360 })).toBe(false)
    expect(isMobileLayout({ native: false, desktop: false, width: MOBILE_MAX_WIDTH })).toBe(true)
    expect(isMobileLayout({ native: false, desktop: false, width: MOBILE_MAX_WIDTH + 1 })).toBe(false)
  })

  it('starts everyone (phone and desktop) on «Олива» (the olive «tarkov» scheme) until a scheme is picked', () => {
    expect(defaultTheme()).toBe('tarkov')
  })
})

describe('live position from the server', () => {
  const now = 1_800_000_000_000
  const base = { x: 10, y: 1, z: -20, yaw: 90, at: now - 5_000, map: 'customs' }

  it('parses the server answer and canonicalizes the map id', () => {
    expect(parseServerPosition({ position: { ...base, map: 'bigmap' } })).toMatchObject({ x: 10, z: -20, map: 'customs' })
    expect(parseServerPosition({ position: null })).toBeNull()
    expect(parseServerPosition({ position: { ...base, x: Number.NaN } })).toBeNull()
    expect(parseServerPosition({ position: { ...base, map: '../../etc' } })?.map).toBeUndefined()
  })

  it('is fresh for three minutes, then stale; without a map it cannot be drawn', () => {
    expect(positionFreshness(null, now).state).toBe('none')
    expect(positionFreshness(base, now)).toEqual({ state: 'fresh', ageMs: 5_000 })
    expect(positionFreshness({ ...base, at: now - POSITION_FRESH_MS - 1 }, now).state).toBe('stale')
    expect(positionFreshness({ ...base, map: undefined }, now).state).toBe('no-map')
  })

  it('trusts the server receive time when the PC clock runs behind', () => {
    const slowClock = { ...base, at: now - 10 * 60_000, receivedAt: new Date(now - 2_000).toISOString() }
    expect(positionFreshness(slowClock, now)).toEqual({ state: 'fresh', ageMs: 2_000 })
  })
})

describe('server address', () => {
  it('accepts HTTPS anywhere and plain HTTP only in the home network', () => {
    expect(normalizeApiUrl('192.168.1.20:8787')).toBe('http://192.168.1.20:8787')
    expect(normalizeApiUrl('http://10.0.0.5:8787/')).toBe('http://10.0.0.5:8787')
    expect(normalizeApiUrl('http://gaming-pc.local:8787')).toBe('http://gaming-pc.local:8787')
    expect(normalizeApiUrl('https://api.example.com')).toBe('https://api.example.com')
    expect(() => normalizeApiUrl('http://api.example.com')).toThrow(/HTTPS/)
    expect(() => normalizeApiUrl('http://172.32.0.1:8787')).toThrow(/HTTPS/)
    expect(() => normalizeApiUrl('https://user:pass@example.com')).toThrow()
    expect(() => normalizeApiUrl('')).toThrow()
  })
})
