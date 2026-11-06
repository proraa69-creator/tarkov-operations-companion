import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const read = (file: string) => readFileSync(file, 'utf8')
const css = read('src/startup/intro.css')
const markup = read('src/startup/intro.html')

describe('the start intro in the page', () => {
  it('index.html has its two places, and the build fills them in', () => {
    const html = read('index.html')
    expect(html).toContain('<!-- startup-intro:head -->')
    expect(html).toContain('<!-- startup-intro:body -->')
    const config = read('vite.config.ts')
    expect(config).toContain('startupIntro()')
    expect(config).toContain("order: 'post'")
  })

  it('no words on it: the name is drawn, the same in Russian and English', () => {
    const withoutTags = markup.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '').trim()
    expect(withoutTags).toBe('')
  })

  it('is the real logo: the R of build/brand/icon.svg, the six letters of name.svg', () => {
    const R = /<g clip-path="url\(#nl168\)"><path d="([^"]+)"/.exec(read('build/brand/icon.svg'))?.[1]
    expect(R).toBeTruthy()
    expect(markup.split(R!).length - 1).toBe(2)
    expect(markup.match(/class="si-l[ "]/g)).toHaveLength(6)
    expect(markup.match(/class="si-l si-os/g)).toHaveLength(2)
    for (const [, d] of read('build/brand/name.svg').matchAll(/<path d="([^"]+)"/g)) {
      for (const part of d!.match(/M[^M]*/g)!) expect(markup).toContain(part.trim())
    }
  })

  it('moves only by opacity and transform: those run while the app\'s code keeps the page busy', () => {
    const blocks = [...css.matchAll(/@keyframes [\w-]+ \{((?:[^{}]*\{[^{}]*\})+)[^{}]*\}/g)]
    expect(blocks.length).toBeGreaterThanOrEqual(9)
    for (const [, body] of blocks) {
      for (const [, frame] of body!.matchAll(/\{([^{}]*)\}/g)) {
        const properties = frame!.split(';').map((rule) => rule.split(':')[0]!.trim()).filter(Boolean)
        for (const property of properties) expect(['opacity', 'transform']).toContain(property)
      }
    }
  })

  it('stands on the colour of the window on every platform, so nothing flashes before the first frame', () => {
    const ground = '#0d1110'
    expect(css).toContain(`background: ${ground}`)
    expect(read('electron/main.ts')).toContain(`backgroundColor: '${ground}'`)
    expect(read('capacitor.config.ts').match(new RegExp(`backgroundColor: '${ground}'`, 'g'))).toHaveLength(2)
  })
})

describe('public/startup-intro.js decides before anything is drawn', () => {
  const run = () => new Function(read('public/startup-intro.js'))()
  const state = () => document.documentElement.getAttribute('data-startup-intro')

  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    document.documentElement.removeAttribute('data-startup-intro')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.getElementById('startup-intro')?.remove()
    document.documentElement.removeAttribute('data-startup-intro')
  })

  it('plays once in a window; a reload there shows the finished logo', () => {
    run()
    expect(state()).toBe('play')
    run()
    expect(state()).toBe('still')
  })

  it('plays when the storage is closed', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => { throw new Error('closed') })
    run()
    expect(state()).toBe('play')
  })

  it('stays away from browser automation (the e2e tests)', () => {
    vi.stubGlobal('navigator', { webdriver: true })
    run()
    expect(state()).toBeNull()
  })

  it('never hides the screen for longer than 20 seconds, even with no app code at all', () => {
    const element = document.createElement('div')
    element.id = 'startup-intro'
    document.body.append(element)
    run()
    vi.advanceTimersByTime(19_999)
    expect(document.getElementById('startup-intro')).toBe(element)
    vi.advanceTimersByTime(1)
    expect(document.getElementById('startup-intro')).toBeNull()
    expect(state()).toBeNull()
  })
})
