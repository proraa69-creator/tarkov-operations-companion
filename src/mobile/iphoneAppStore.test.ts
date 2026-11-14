import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: async () => undefined }), getInfo: async () => ({ version: '1.0', build: '2' }) } }))

import { APP_STORE_LOOKUP_URL, checkIphoneUpdate, newerAppStoreRelease, resetIphoneUpdate, useIphoneUpdate } from './iphoneUpdate'
import { renderHook } from '@testing-library/react'

/**
 * Owner, 15.11.2026: «com.raidos.app — это будет наша ссылка в App Store… будет появляться кнопка «Обновить приложение», и при
 * нажатии… будет открываться страница в App Store… приложение на сайте с ссылкой на сайт».
 */
const PAGE = 'https://apps.apple.com/ru/app/raid-os/id6700000000?uo=4'
const lookup = (results: unknown[]) => ({ resultCount: results.length, results })
const site = { version: '0.6.0-306', iphone: { url: 'https://raidos.app/download' } }

function fetcher(answers: Record<string, unknown>) {
  const asked: string[] = []
  const fn = (async (url: string) => { asked.push(url); return { ok: true, json: async () => answers[url] ?? {} } }) as unknown as typeof fetch
  return { fn, asked }
}

afterEach(() => { resetIphoneUpdate() })

describe('the App Store build asks the App Store', () => {
  it('a newer version there: «Обновить» opens its App Store page', async () => {
    const { fn } = fetcher({ [APP_STORE_LOOKUP_URL]: lookup([{ bundleId: 'com.raidos.app', version: '1.1', trackViewUrl: PAGE }]) })
    await checkIphoneUpdate(fn, '0.6.0-306', true)
    const { result } = renderHook(() => useIphoneUpdate())
    expect(result.current.available).toBe('1.1')
    expect(result.current.url).toBe(PAGE)
  })

  it('compares with its own App Store version, not the site\'s numbering, and says nothing before the app is out', async () => {
    const same = fetcher({ [APP_STORE_LOOKUP_URL]: lookup([{ bundleId: 'com.raidos.app', version: '1.0', trackViewUrl: PAGE }]), 'https://raidos.app/v1/downloads/mobile.json': site })
    await checkIphoneUpdate(same.fn, '0.6.0-306', true)
    expect(renderHook(() => useIphoneUpdate()).result.current.available).toBeNull()
    const none = fetcher({ [APP_STORE_LOOKUP_URL]: lookup([]), 'https://raidos.app/v1/downloads/mobile.json': site })
    await checkIphoneUpdate(none.fn, '0.6.0-306', true)
    expect(renderHook(() => useIphoneUpdate()).result.current.available).toBeNull()
    expect(none.asked).toEqual([APP_STORE_LOOKUP_URL, 'https://raidos.app/v1/downloads/mobile.json'])
  })

  it('the build from the site never asks the App Store: its update goes to the site', async () => {
    const { fn, asked } = fetcher({ 'https://raidos.app/v1/downloads/mobile.json': site })
    await checkIphoneUpdate(fn, '0.6.0-305', false)
    expect(asked).toEqual(['https://raidos.app/v1/downloads/mobile.json'])
    const state = renderHook(() => useIphoneUpdate()).result.current
    expect(state.available).toBe('0.6.0-306')
    expect(state.url).toBe('https://raidos.app/download')
  })

  it('takes only an apps.apple.com page of this very app', () => {
    expect(newerAppStoreRelease(lookup([{ bundleId: 'com.other.app', version: '9.0', trackViewUrl: PAGE }]), '1.0')).toBeNull()
    expect(newerAppStoreRelease(lookup([{ bundleId: 'com.raidos.app', version: '9.0', trackViewUrl: 'https://evil.example/app' }]), '1.0')).toBeNull()
  })
})
