import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLIGHT_MS } from '../../src/startup/opening'
import { holdTrailer, openSite, settleUnderIntro, WORDMARK } from './siteOpening'

const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

/** The home page as far as the opening cares, each element with the place it would have in a browser. */
function homePage() {
  document.body.innerHTML = `
    <div id="startup-intro"><div class="si-lockup"><div class="si-mk"></div><div class="si-nm"></div></div></div>
    <header class="site-header"><div class="container">
      <a class="brand"><img class="brand-logo-tile" /><span><img class="brand-logo-name" /><span class="brand-sub"></span></span></a>
      <nav class="site-nav"><a id="nav-home"></a></nav>
      <div class="header-actions"><a id="download"></a><button id="menu-hidden"></button></div>
    </div></header>
    <div class="route-view"><section class="hero">
      <div class="eyebrow"></div><h1 class="hero-wordmark"><img src="/brand/wordmark.svg" /></h1><p class="hero-lead"></p>
      <div class="hero-stage"><div class="trailer"></div></div>
      <div class="hero-actions center"><a id="action"></a></div><ul class="platforms"></ul><p class="hero-note"></p>
    </section></div>`
  const places: Array<[string, DOMRect]> = [
    ['.si-mk', box(400, 300, 300, 300)], ['.si-nm', box(740, 380, 600, 120)],
    ['.brand-logo-tile', box(100, 13, 42, 42)], ['.brand-logo-name', box(153, 16, 84, 17)], ['.brand-sub', box(153, 38, 144, 14)],
    ['.site-header', box(0, 0, 1600, 68)], ['#nav-home', box(330, 15, 80, 38)], ['#download', box(800, 14, 200, 40)],
    ['.eyebrow', box(420, 124, 760, 17)], ['.hero-wordmark img', box(520, 159, 560, 161)], ['.hero-lead', box(520, 336, 560, 28)],
    ['.hero-stage', box(260, 402, 1080, 608)], ['.trailer', box(260, 402, 1080, 608)],
    ['#action', box(600, 1043, 226, 50)], ['.platforms', box(100, 1111, 1132, 20)], ['.hero-note', box(100, 1149, 1132, 20)],
  ]
  for (const [selector, place] of places) {
    const element = document.querySelector(selector) as HTMLElement
    element.getBoundingClientRect = () => place
  }
  Element.prototype.getAnimations = () => []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  return document.getElementById('startup-intro')!
}

function recordMoves() {
  const moves: Array<{ element: Element; frames: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn>; finished: Promise<void> }> = []
  let finish = () => {}
  const finished = new Promise<void>((resolve) => { finish = resolve })
  Element.prototype.animate = function animate(this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    const move = { element: this, frames, options, cancel: vi.fn(), finished }
    moves.push(move)
    return move as unknown as Animation
  } as unknown as typeof Element.prototype.animate
  return { moves, finish }
}

afterEach(() => {
  document.body.innerHTML = ''
  delete (Element.prototype as Partial<Element>).animate
  delete (Element.prototype as Partial<Element>).getAnimations
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the emblem flies to the header and the page puts itself together (owner, 06.11.2026)', () => {
  it('the emblem and the name land exactly on the header\'s own', () => {
    const intro = homePage()
    const { moves } = recordMoves()
    void openSite(intro)
    const flight = (selector: string) => moves.find((move) => move.element === intro.querySelector(selector) && String(move.frames[1].transform).startsWith('translate'))!
    expect(flight('.si-mk').frames[1].transform).toBe(`translate(${100 - 400}px, ${13 - 300}px) scale(${42 / 300}, ${42 / 300})`)
    expect(flight('.si-nm').frames[1].transform).toBe(`translate(${153 - 740}px, ${16 - 380}px) scale(${84 / 600}, ${17 / 120})`)
    expect(flight('.si-mk').options.duration).toBe(FLIGHT_MS)
  })

  it('the header\'s own emblem appears as the flying one arrives: there is always one on screen', () => {
    const intro = homePage()
    const { moves } = recordMoves()
    void openSite(intro)
    const tile = document.querySelector('.brand-logo-tile')
    const held = moves.find((move) => move.element === tile && move.frames[0].opacity === 0)!
    const leaves = moves.find((move) => move.element === intro.querySelector('.si-mk') && move.frames[1].opacity === 0)!
    expect(held.options.duration).toBe(leaves.options.delay)
  })

  it('every piece of the page takes part, hidden ones do not', () => {
    const intro = homePage()
    const { moves } = recordMoves()
    void openSite(intro)
    const moved = new Set(moves.map((move) => move.element))
    for (const selector of ['#nav-home', '#download', '.brand-sub', '.eyebrow', '.hero-wordmark img', '.hero-lead', '.hero-stage', '#action', '.platforms', '.hero-note']) {
      expect(moved.has(document.querySelector(selector)!), selector).toBe(true)
    }
    expect(moved.has(document.getElementById('menu-hidden')!)).toBe(false)
  })

  it('at rest the page is what it was: nothing held, nothing left behind', async () => {
    const intro = homePage()
    const { moves, finish } = recordMoves()
    const childrenBefore = document.body.childElementCount
    const opening = openSite(intro)!
    expect(document.querySelector<HTMLElement>('.site-header .container')!.style.overflow).toBe('clip')
    expect(document.body.childElementCount).toBe(childrenBefore + 1)
    finish()
    await opening
    expect(moves.every((move) => move.cancel.mock.calls.length === 1)).toBe(true)
    expect(document.querySelector<HTMLElement>('.site-header .container')!.style.overflow).toBe('')
    expect(document.body.childElementCount).toBe(childrenBefore)
  })

  it('a window hidden all along, whose animations never run, is released too', async () => {
    vi.useFakeTimers()
    const intro = homePage()
    const { moves } = recordMoves()
    const opening = openSite(intro)!
    await vi.advanceTimersByTimeAsync(10_000)
    await opening
    expect(moves.every((move) => move.cancel.mock.calls.length === 1)).toBe(true)
  })

  it('no page to fly to, or a browser that cannot: it says so and the intro fades as in the app', () => {
    const intro = homePage()
    expect(openSite(intro)).toBeUndefined() // no element.animate here
    recordMoves()
    document.querySelector('.hero')!.remove()
    expect(openSite(intro)).toBeUndefined()
  })
})

describe('under the intro', () => {
  it('the entrance of the page is finished before anything is drawn', () => {
    document.body.innerHTML = '<div class="route-view"><p class="stagger"></p></div><div class="cookie-notice"></div><p id="other"></p>'
    const finish = vi.fn()
    Element.prototype.getAnimations = function getAnimations(this: Element) {
      return this.id === 'other' ? [] : [{ finish }] as unknown as Animation[]
    }
    settleUnderIntro()
    expect(finish).toHaveBeenCalledTimes(3)
  })

  it('a browser that cannot say what is moving: nothing breaks', () => {
    document.body.innerHTML = '<p class="stagger"></p>'
    expect(() => settleUnderIntro()).not.toThrow()
  })
})

describe('the trailer in the opening', () => {
  it('waits at its first frame under the intro', () => {
    document.body.innerHTML = '<div class="route-view"><section class="hero"><video></video></section></div>'
    const video = document.querySelector('video')!
    video.pause = vi.fn()
    Object.defineProperty(video, 'readyState', { value: 2 })
    video.currentTime = 5
    holdTrailer()
    expect(video.pause).toHaveBeenCalled()
    expect(video.currentTime).toBe(0)
  })

  it('starts as it begins to show, and when the opening cannot run', () => {
    vi.useFakeTimers()
    const intro = homePage()
    recordMoves()
    const video = document.createElement('video')
    video.play = vi.fn(() => Promise.resolve())
    document.querySelector('.hero')!.append(video)
    void openSite(intro)
    expect(video.play).not.toHaveBeenCalled()
    vi.advanceTimersByTime(440)
    expect(video.play).toHaveBeenCalledTimes(1)
    document.querySelector('.si-mk')!.remove()
    openSite(intro)
    expect(video.play).toHaveBeenCalledTimes(2)
  })
})

describe('the big name is cut where the artwork really has its letters', () => {
  const svg = readFileSync('website/public/brand/wordmark.svg', 'utf8')
  const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1])
  /** M, L and Q give pairs; H and V give one number each. */
  const extent = (d: string) => {
    const xs: number[] = []
    const ys: number[] = []
    for (const [, command, args] of d.matchAll(/([MLQHV])([^MLQHVZ]*)/g)) {
      const numbers = (args!.match(/-?\d*\.?\d+/g) ?? []).map(Number)
      if (command === 'H') xs.push(...numbers)
      else if (command === 'V') ys.push(...numbers)
      else numbers.forEach((value, i) => (i % 2 === 0 ? xs : ys).push(value))
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
  }

  it('the picture\'s box', () => {
    const [left, top, width, height] = svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number)
    expect([left, top]).toEqual([WORDMARK.left, WORDMARK.top])
    expect(width).toBeCloseTo(WORDMARK.width, 1)
    expect(height).toBeCloseTo(WORDMARK.height, 1)
  })

  it('every closed part of every letter stands inside one column, and the columns do not touch', () => {
    const parts = [...paths[0].match(/M[^M]*/g)!, ...paths[1].match(/M[^M]*/g)!].map(extent)
    for (const part of parts) {
      expect(WORDMARK.letters.some(([x0, x1]) => part.x0 >= x0 - 0.1 && part.x1 <= x1 + 0.1), JSON.stringify(part)).toBe(true)
    }
    WORDMARK.letters.forEach(([, x1], i) => {
      if (i + 1 < WORDMARK.letters.length) expect(x1 + 1).toBeLessThan(WORDMARK.letters[i + 1][0] - 1)
    })
    expect(WORDMARK.letters).toHaveLength(6)
  })

  it('the letters and the line under them each have a band of their own, the stitch runs between them', () => {
    const letters = [extent(paths[0]), extent(paths[1])]
    const line = extent(paths[3])
    expect(Math.max(...letters.map((part) => part.y1))).toBeLessThan(WORDMARK.lettersBand[1])
    expect(line.y0).toBeGreaterThan(WORDMARK.lineBand[0])
    expect(line.y1).toBeLessThan(WORDMARK.lineBand[1])
    expect(WORDMARK.stitch.y).toBeGreaterThan(WORDMARK.lettersBand[1])
    expect(WORDMARK.stitch.y).toBeLessThan(WORDMARK.lineBand[0])
  })

  it('the stitch drawn while it opens is the one in the picture', () => {
    const { x0, x1, y, on, off, width, colour } = WORDMARK.stitch
    expect(svg).toContain(`M${x0} ${y}H`)
    expect(paths[2]).toMatch(new RegExp(`^M${x0} ${y}H${Math.floor(x1)}`))
    expect(svg).toContain(`stroke-dasharray="${on} ${off}"`)
    expect(svg).toContain(`stroke-width="${width}"`)
    expect(svg).toContain(`stroke="${colour}"`)
  })
})
