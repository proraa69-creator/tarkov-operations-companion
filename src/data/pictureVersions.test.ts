import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Owner, 13.11.2026: «если у нас на сервере происходит замена, то приложение берет один раз от туда новую картинку и сам меняет».
const TASK = '64f83bd983cfca080a362c82'
const WEAPON = '64ca3d3954fc657e230529cc'

describe('pictures the server may replace', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('a build screenshot and a replaced photo take their version into the address; nothing without one', async () => {
    const { refreshPictureVersions, serverBuildScreenshot, guideReplacementVersion } = await import('./pictureVersions')
    const { guidePhotoUrl } = await import('./guidePhotoUrl')
    expect(serverBuildScreenshot(TASK, WEAPON)).toBeUndefined()
    expect(guidePhotoUrl('0123456789abcdef', 'a.png', false)).toBe('https://raidos.app/v1/guide-images/wiki-0123456789abcdef.png?v=2')
    const request = vi.fn(async (_method: string, path: string) => path === '/v1/build-screenshots'
      ? { screenshots: [{ task: TASK, weapon: WEAPON, version: 'abcdef0123456789' }, { task: 'bad', weapon: WEAPON, version: 'abcdef0123456789' }] }
      : { versions: { 'wiki-0123456789abcdef.png': '0011223344556677', '../evil.png': '0011223344556677' } })
    await refreshPictureVersions(request)
    expect(serverBuildScreenshot(TASK, WEAPON)).toBe(`https://raidos.app/v1/build-screenshots/${TASK}_${WEAPON}.webp?v=abcdef0123456789`)
    expect(guideReplacementVersion('../evil.png')).toBeUndefined()
    expect(guidePhotoUrl('0123456789abcdef', 'a.png', false)).toBe('https://raidos.app/v1/guide-images/wiki-0123456789abcdef.png?v=2&r=0011223344556677')
    expect(guidePhotoUrl('0123456789abcdef', 'a.png', true)).toBe('https://raidos.app/v1/guide-images/wiki-0123456789abcdef-t.png?v=2')
  })

  it('kept for the next start, offline too; an older server without the routes leaves them as they were', async () => {
    const first = await import('./pictureVersions')
    await first.refreshPictureVersions(async (_method: string, path: string) => path === '/v1/build-screenshots' ? { screenshots: [{ task: TASK, weapon: WEAPON, version: 'abcdef0123456789' }] } : { versions: {} })
    vi.resetModules()
    const next = await import('./pictureVersions')
    expect(next.serverBuildScreenshot(TASK, WEAPON)).toContain('v=abcdef0123456789')
    await next.refreshPictureVersions(async () => { throw new Error('404') })
    expect(next.serverBuildScreenshot(TASK, WEAPON)).toContain('v=abcdef0123456789')
  })
})
