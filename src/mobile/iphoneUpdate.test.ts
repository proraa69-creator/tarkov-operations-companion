import { afterEach, describe, expect, it } from 'vitest'
import { checkIphoneUpdate, compareVersions, MOBILE_RELEASE_URL, newerIphoneRelease, resetIphoneUpdate, useIphoneUpdate } from './iphoneUpdate'
import { renderHook } from '@testing-library/react'
import { exactUiText } from '../i18n/uiEnglish'

const json = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch

afterEach(() => resetIphoneUpdate())

describe('«Вышла новая версия» in the iPhone app', () => {
  it('compares the owner\'s versions in both spellings', () => {
    expect(compareVersions('0.6.0-113', '0.6.0.97')).toBeGreaterThan(0)
    expect(compareVersions('0.6.0.97', '0.6.0-97')).toBe(0)
    expect(compareVersions('0.6.0-9', '0.6.0-10')).toBeLessThan(0)
  })

  it('offers only a newer iPhone build of the site', () => {
    expect(newerIphoneRelease({ version: '0.6.0-113', iphone: { size: 1 } }, '0.6.0-97')).toBe('0.6.0-113')
    expect(newerIphoneRelease({ version: '0.6.0-113', android: { size: 1 } }, '0.6.0-97')).toBeNull()
    expect(newerIphoneRelease({ version: '0.6.0-97', iphone: { size: 1 } }, '0.6.0-97')).toBeNull()
    expect(newerIphoneRelease('nope', '0.6.0-97')).toBeNull()
  })

  it('reads the site\'s mobile.json and keeps quiet when it cannot', async () => {
    let asked = ''
    await checkIphoneUpdate((async (url: string) => { asked = url; return { ok: true, json: async () => ({ version: '0.6.0-120', iphone: { size: 5 } }) } }) as unknown as typeof fetch, '0.6.0-97')
    expect(asked).toBe(MOBILE_RELEASE_URL)
    expect(renderHook(() => useIphoneUpdate()).result.current.available).toBe('0.6.0-120')
    resetIphoneUpdate()
    await checkIphoneUpdate(json({}, false), '0.6.0-97')
    await checkIphoneUpdate((async () => { throw new Error('offline') }) as unknown as typeof fetch, '0.6.0-97')
    expect(renderHook(() => useIphoneUpdate()).result.current.available).toBeNull()
  })

  it('has its English', () => {
    expect(exactUiText('Вышла новая версия')).toBe('A new version is out')
    expect(exactUiText('Скачать на сайте')).toBe('Download from the site')
  })
})
