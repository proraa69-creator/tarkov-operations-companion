import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const read = (file: string) => readFileSync(file, 'utf8')

describe('the site opens with the emblem (owner, 06.11.2026: «полная анимация эмблемы и открытие сайта»)', () => {
  const run = () => new Function(read('website/src/startupIntroHead.js'))()
  const state = () => document.documentElement.getAttribute('data-startup-intro')

  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.getElementById('startup-intro')?.remove()
    document.documentElement.removeAttribute('data-startup-intro')
  })

  it('the whole animation on the first page of a tab, none on a reload there', () => {
    run()
    expect(state()).toBe('play')
    document.documentElement.removeAttribute('data-startup-intro')
    run()
    expect(state()).toBeNull()
  })

  it('stays away from browser automation and page renderers', () => {
    vi.stubGlobal('navigator', { webdriver: true })
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

  it('stands before #root: the page already in the HTML cannot be drawn ahead of it', () => {
    const html = read('website/index.html')
    expect(html).toContain('<!-- startup-intro:head -->')
    expect(html.indexOf('<!-- startup-intro:body -->')).toBeGreaterThan(html.indexOf('<body>'))
    expect(html.indexOf('<!-- startup-intro:body -->')).toBeLessThan(html.indexOf('<div id="root">'))
    // The prerender fills exactly this element (scripts/prerender-website.mjs).
    expect(html).toContain('<div id="root"></div>')
  })
})
