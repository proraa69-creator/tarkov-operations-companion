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

describe('the intro\'s size (owner, 06.11.2026)', () => {
  const run = () => new Function(read('public/startup-intro.js'))()
  const size = () => document.documentElement.getAttribute('data-startup-intro-size')
  beforeEach(() => {
    sessionStorage.clear()
    document.documentElement.removeAttribute('data-startup-intro')
    document.documentElement.removeAttribute('data-startup-intro-size')
  })
  afterEach(() => { delete (window as { tarkovDesktop?: unknown }).tarkovDesktop })

  it('a third on the iPhone: the way Capacitor itself tells it, and neither on Android nor in a browser', () => {
    vi.stubGlobal('navigator', { ...navigator, webdriver: false })
    vi.stubGlobal('webkit', { messageHandlers: { bridge: {} } })
    run()
    expect(size()).toBe('third')
    document.documentElement.removeAttribute('data-startup-intro-size')
    vi.stubGlobal('webkit', { messageHandlers: {} })
    run()
    expect(size()).toBeNull()
    vi.unstubAllGlobals()
    expect(css).toContain('--si-t: calc(50vmin / 3); --si-nh: calc(14.5vmin / 3); --si-gap: calc(7vmin / 3)')
    expect(css).toContain('--si-t: 50vmin; --si-nh: 14.5vmin; --si-gap: 7vmin')
  })

  it('small in the PC app, at its full size on the phone and in a browser', () => {
    vi.stubGlobal('navigator', { ...navigator, webdriver: false })
    run()
    expect(size()).toBeNull()
    document.documentElement.removeAttribute('data-startup-intro')
    ;(window as { tarkovDesktop?: unknown }).tarkovDesktop = {}
    run()
    expect(size()).toBe('small')
    vi.unstubAllGlobals()
  })

  it('the small size is a little over the 38 px logo, the row kept even in a tall window', () => {
    expect(css).toMatch(/\[data-startup-intro-size="small"\] #startup-intro \{ --si-t: 64px/)
    expect(css).toMatch(/\[data-startup-intro-size="small"\] \.si-lockup \{ flex-direction: row \}/)
  })
})

describe('the thread keeps turning while the app loads (owner, 07.11.2026: «Люди подумают, что приложение зависло»)', () => {
  it('on the emblem\'s own stitch, right after the intro, with no end and no script', () => {
    expect(css).toMatch(/\.si-d\.si-run \{[^}]*si-turn 1\.28s linear calc\(1\.7s \+ var\(--k\) \* 2ms\) infinite/)
    expect(markup.match(/class="si-d si-run"/g)!.length).toBeGreaterThan(20)
  })

  it('every picture has one animation: two on one element would stop whenever the page is busy', () => {
    for (const name of ['si-hot', 'si-run']) {
      const rule = css.split('\n').find((line) => line.startsWith(`.si-d.${name} {`))
      expect(rule, name).toContain('animation: ')
      expect(rule!.split('animation: ')[1], name).not.toContain(',')
    }
  })

  it('one turn is the bright run of the intro slowed down twice, so its last picture meets its first', () => {
    const keys = [...new Set([...markup.matchAll(/--k:(\d+)/g)].map((found) => Number(found[1])))]
    const step = keys[1]! - keys[0]!
    expect(1280 - Math.max(...keys) * 2).toBeLessThan(step * 2 + 6)
  })

  it('also after a reload in the same window, where everything else stands', () => {
    expect(css).toMatch(/\[data-startup-intro="still"\] #startup-intro \*:not\(\.si-run\) \{ animation: none !important \}/)
    expect(css).toMatch(/\[data-startup-intro="still"\] #startup-intro \.si-run \{ animation: si-turn/)
  })

  it('motion turned off: it only brightens and dims, nothing travels', () => {
    const off = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(off).toContain('si-breathe 1.8s ease-in-out infinite !important')
    expect(off).not.toContain('calc(var(--k)')
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
