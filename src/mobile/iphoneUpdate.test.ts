import { afterEach, describe, expect, it } from 'vitest'
import { checkIphoneUpdate, compareVersions, IPHONE_DOWNLOAD_PAGE, MOBILE_RELEASE_URL, newerIphoneRelease, resetIphoneUpdate, useIphoneUpdate } from './iphoneUpdate'
import { renderHook } from '@testing-library/react'
import { exactUiText } from '../i18n/uiEnglish'

const json = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch
const STORE = 'https://apps.apple.com/app/raid-os/id1234567890'

afterEach(() => resetIphoneUpdate())

describe('«Вышла новая версия» in the iPhone app', () => {
  it('compares the owner\'s versions in both spellings', () => {
    expect(compareVersions('0.6.0-113', '0.6.0.97')).toBeGreaterThan(0)
    expect(compareVersions('0.6.0.97', '0.6.0-97')).toBe(0)
    expect(compareVersions('0.6.0-9', '0.6.0-10')).toBeLessThan(0)
  })

  it('offers only a newer iPhone build of the site, with the site\'s download page', () => {
    expect(newerIphoneRelease({ version: '0.6.0-113', iphone: { size: 1 } }, '0.6.0-97')).toEqual({ version: '0.6.0-113', url: IPHONE_DOWNLOAD_PAGE })
    expect(newerIphoneRelease({ version: '0.6.0-113', android: { size: 1 } }, '0.6.0-97')).toBeNull()
    expect(newerIphoneRelease({ version: '0.6.0-97', iphone: { size: 1 } }, '0.6.0-97')).toBeNull()
    expect(newerIphoneRelease('nope', '0.6.0-97')).toBeNull()
  })

  // Owner, 09.11.2026: «мы просто поменяем ссылку, и будет перекидывать без обновления приложения. На App Store».
  it('the server\'s App Store switch: «Обновить» opens the App Store, versions come from it', () => {
    const on = { version: '0.6.0-120', iphone: { size: 1, url: STORE, storeVersion: '0.6.0.118' } }
    expect(newerIphoneRelease(on, '0.6.0-97')).toEqual({ version: '0.6.0.118', url: STORE })
    // the App Store build too
    expect(newerIphoneRelease(on, '0.6.0-97', true)).toEqual({ version: '0.6.0.118', url: STORE })
    expect(newerIphoneRelease(on, '0.6.0-118', true)).toBeNull()
    // The switch without the App Store's version: the site's build still goes to the App Store; the App Store build waits.
    const noVersion = { version: '0.6.0-120', iphone: { url: STORE } }
    expect(newerIphoneRelease(noVersion, '0.6.0-97')).toEqual({ version: '0.6.0-120', url: STORE })
    expect(newerIphoneRelease(noVersion, '0.6.0-97', true)).toBeNull()
    // Switch off: the App Store build never points at the site.
    expect(newerIphoneRelease({ version: '0.6.0-120', iphone: { size: 1 } }, '0.6.0-97', true)).toBeNull()
    // Only an App Store address is followed.
    expect(newerIphoneRelease({ version: '0.6.0-120', iphone: { url: 'https://evil.example/app' } }, '0.6.0-97')).toEqual({ version: '0.6.0-120', url: IPHONE_DOWNLOAD_PAGE })
  })

  it('reads mobile.json and keeps quiet when it cannot', async () => {
    let asked = ''
    await checkIphoneUpdate((async (url: string) => { asked = url; return { ok: true, json: async () => ({ version: '0.6.0-120', iphone: { size: 5, url: STORE } }) } }) as unknown as typeof fetch, '0.6.0-97', false)
    expect(asked).toBe(MOBILE_RELEASE_URL)
    const { result } = renderHook(() => useIphoneUpdate())
    expect(result.current.available).toBe('0.6.0-120')
    expect(result.current.url).toBe(STORE)
    resetIphoneUpdate()
    await checkIphoneUpdate(json({}, false), '0.6.0-97', false)
    await checkIphoneUpdate((async () => { throw new Error('offline') }) as unknown as typeof fetch, '0.6.0-97', false)
    expect(renderHook(() => useIphoneUpdate()).result.current.available).toBeNull()
  })

  it('has its English', () => {
    expect(exactUiText('Вышла новая версия')).toBe('A new version is out')
    expect(exactUiText('Вышла новая версия приложения')).toBe('A new version of the app is out')
  })
})
