import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const read = (file: string) => readFileSync(file, 'utf8')

describe('the site opens with the emblem (owner, 06.11.2026: «полная анимация эмблемы и открытие сайта»)', () => {
  const run = () => new Function(read('website/src/startupIntroHead.js'))()
  const state = () => document.documentElement.getAttribute('data-startup-intro')

  const media = (matching: string[] = []) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: matching.some((part) => query.includes(part)) }))
  const at = (path: string) => window.history.replaceState(null, '', path)

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    media()
    at('/')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.getElementById('startup-intro')?.remove()
    document.documentElement.removeAttribute('data-startup-intro')
    document.documentElement.removeAttribute('data-startup-intro-out')
    vi.restoreAllMocks()
  })

  it('the whole animation once in a browser: whoever comes back is not kept waiting', () => {
    run()
    expect(state()).toBe('play')
    document.documentElement.removeAttribute('data-startup-intro')
    run()
    expect(state()).toBeNull()
  })

  it('stays away from browser automation', () => {
    vi.stubGlobal('navigator', { webdriver: true })
    run()
    expect(state()).toBeNull()
  })

  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Chrome-Lighthouse',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
  ])('a search engine reads the page at once: %s', (userAgent) => {
    vi.stubGlobal('navigator', { webdriver: false, userAgent })
    run()
    expect(state()).toBeNull()
    // And its visit is not counted as the visitor's.
    expect(localStorage.getItem('raidos-site-intro')).toBeNull()
  })

  it('a phone, a narrow window or motion turned off: the page opens at once', () => {
    for (const asked of ['prefers-reduced-motion', 'pointer: coarse', 'max-width: 720px']) {
      localStorage.clear()
      media([asked])
      run()
      expect(state(), asked).toBeNull()
    }
  })

  it('only the home page: a link to another page opens that page, and counts as the visit', () => {
    at('/download')
    run()
    expect(state()).toBeNull()
    at('/')
    run()
    expect(state()).toBeNull()
  })

  it('the language in the address is still the home page', () => {
    at('/?lang=en')
    run()
    expect(state()).toBe('play')
  })

  it('a browser that cannot remember is not kept waiting on every visit', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    run()
    expect(state()).toBeNull()
  })

  it('a slow connection does not keep the page from the visitor for longer than 6 seconds', () => {
    const element = document.createElement('div')
    element.id = 'startup-intro'
    document.body.append(element)
    run()
    vi.advanceTimersByTime(5_999)
    expect(document.getElementById('startup-intro')).toBe(element)
    vi.advanceTimersByTime(1)
    expect(document.getElementById('startup-intro')).toBeNull()
    expect(state()).toBeNull()
  })

  it('the limit does not cut an opening already under way', () => {
    const element = document.createElement('div')
    element.id = 'startup-intro'
    document.body.append(element)
    run()
    document.documentElement.setAttribute('data-startup-intro-out', '')
    vi.advanceTimersByTime(6_000)
    expect(document.getElementById('startup-intro')).toBe(element)
  })

  it('stands before #root: the page already in the HTML cannot be drawn ahead of it', () => {
    const html = read('website/index.html')
    expect(html).toContain('<!-- startup-intro:head -->')
    expect(html.indexOf('<!-- startup-intro:body -->')).toBeGreaterThan(html.indexOf('<body>'))
    expect(html.indexOf('<!-- startup-intro:body -->')).toBeLessThan(html.indexOf('<div id="root">'))
    // The prerender fills exactly this element (scripts/prerender-website.mjs).
    expect(html).toContain('<div id="root"></div>')
  })
})
