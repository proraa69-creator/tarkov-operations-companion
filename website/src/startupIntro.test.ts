import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const read = (file: string) => readFileSync(file, 'utf8')

describe('the site opens with the emblem (owner, 06.11.2026: «полная анимация эмблемы и открытие сайта»)', () => {
  const run = () => new Function(read('website/src/startupIntroHead.js'))()
  const state = () => document.documentElement.getAttribute('data-startup-intro')

  const started = (how: string, referrer = '') => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: how }] as unknown as PerformanceEntryList)
    Object.defineProperty(document, 'referrer', { configurable: true, get: () => referrer })
  }
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
    Reflect.deleteProperty(document, 'referrer')
  })

  it('each time the site is started (owner, 07.11.2026: «Я запускаю сайт, а анимации нету»): nothing is remembered', () => {
    run()
    expect(state()).toBe('play')
    document.documentElement.removeAttribute('data-startup-intro')
    run()
    expect(state()).toBe('play')
    expect(localStorage.getItem('raidos-site-intro')).toBeNull()
  })

  it('an old visit remembered by the last versions does not stop it', () => {
    localStorage.setItem('raidos-site-intro', '1')
    run()
    expect(state()).toBe('play')
  })

  it('a reload is a start, even after a link on the site itself', () => {
    started('reload', `${location.origin}/download`)
    run()
    expect(state()).toBe('play')
  })

  it('from another site or from a search engine is a start', () => {
    started('navigate', 'https://yandex.ru/search')
    run()
    expect(state()).toBe('play')
  })

  it('«Назад» and a link on the site itself are not', () => {
    started('back_forward')
    run()
    expect(state()).toBeNull()
    started('navigate', `${location.origin}/download`)
    run()
    expect(state()).toBeNull()
  })

  it('a browser that does not report how it came here still plays', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
    run()
    expect(state()).toBe('play')
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
  })

  it('motion turned off: the page opens at once', () => {
    media(['prefers-reduced-motion'])
    run()
    expect(state()).toBeNull()
  })

  it('a phone and a touch screen play it too (owner, 07.11.2026: «Так сделай везде»)', () => {
    media(['pointer: coarse', 'max-width: 720px'])
    run()
    expect(state()).toBe('play')
  })

  it('only the home page: a link to another page opens that page', () => {
    at('/download')
    run()
    expect(state()).toBeNull()
  })

  it('the language in the address is still the home page', () => {
    at('/?lang=en')
    run()
    expect(state()).toBe('play')
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

  it('half the size of the app\'s (owner, 06.11.2026: «Сделай в 2 раза меньше»)', () => {
    const sizes = (css: string) => [...css.matchAll(/--si-t:\s*([\d.]+)vmin;\s*--si-nh:\s*([\d.]+)vmin;\s*--si-gap:\s*([\d.]+)vmin/g)].map((found) => found.slice(1).map(Number))
    const app = sizes(read('src/startup/intro.css'))
    const site = sizes(read('website/src/startupIntroSite.css'))
    expect(app).toHaveLength(2)
    expect(site).toEqual(app.map((form) => form.map((size) => size / 2)))
    expect(read('website/vite.config.ts')).toContain('startupIntroSite.css')
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
