import { describe, expect, it } from 'vitest'
import { isYandexAppBrowser } from './inAppBrowser'

/** User agents as raidos.app's log has them (other phone models). */
const UA = {
  yandexAppWebOmni: 'Mozilla/5.0 (Linux; arm_64; Android 16; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.75 YaSearchBrowser/26.102.1 BroPP/1.0 YaSearchApp/26.102.1 webOmni Mobile Safari/537.36',
  yandexAppAndroid: 'Mozilla/5.0 (Linux; arm_64; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.151 YaApp_Android/26.100.1 YaSearchBrowser/26.100.1 BroPP/1.0 Mobile Safari/537.36',
  yandexAppIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 YaApp_iOS/2610.0 YaApp_iOS_Browser/2610.0 Mobile/15E148 Safari/604.1',
  yandexBrowser: 'Mozilla/5.0 (Linux; arm_64; Android 17; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.126 YaBrowser/26.10.2.126.00 Mobile Safari/537.36',
  yandexBrowserPc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 YaBrowser/26.10.0.0 Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 16; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
  operaGx: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 OPR/138.0.0.0 (Edition ms_store_gx)',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
}

describe('isYandexAppBrowser', () => {
  it('the «Яндекс» app: Android with webOmni and before it, iOS', () => {
    expect(isYandexAppBrowser(UA.yandexAppWebOmni)).toBe(true)
    expect(isYandexAppBrowser(UA.yandexAppAndroid)).toBe(true)
    expect(isYandexAppBrowser(UA.yandexAppIos)).toBe(true)
  })

  it('not Яндекс Браузер or any other browser', () => {
    for (const ua of [UA.yandexBrowser, UA.yandexBrowserPc, UA.chromeAndroid, UA.operaGx, UA.safariIos, '']) expect(isYandexAppBrowser(ua), ua).toBe(false)
  })
})
