import { afterEach, describe, expect, it, vi } from 'vitest'
import { installNativeConfirm } from './nativeConfirm'

const browserConfirm = window.confirm

afterEach(() => {
  window.confirm = browserConfirm
  delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
  document.documentElement.lang = ''
})

describe('window.confirm in the desktop app', () => {
  it('asks the main process, in the app\'s language, and answers as it does', () => {
    const confirm = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    window.tarkovDesktop = { isDesktop: true, confirm } as unknown as typeof window.tarkovDesktop
    expect(installNativeConfirm()).toBe(true)
    document.documentElement.lang = 'ru'
    expect(window.confirm('Начислить дни?')).toBe(true)
    document.documentElement.lang = 'en'
    expect(window.confirm('Remove the build?')).toBe(false)
    expect(confirm.mock.calls).toEqual([['Начислить дни?', 'ru'], ['Remove the build?', 'en']])
  })

  it('leaves the browser\'s own on the site, the phone and with an older main process', () => {
    expect(installNativeConfirm()).toBe(false)
    window.tarkovDesktop = { isDesktop: true } as unknown as typeof window.tarkovDesktop
    expect(installNativeConfirm()).toBe(false)
    expect(window.confirm).toBe(browserConfirm)
  })
})
