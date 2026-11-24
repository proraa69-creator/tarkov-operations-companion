import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandNameBox, openApp, pagePieces, prepareAppOpening } from './appOpening'
import { FLIGHT_MS, LANDS_MS } from './opening'

const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

/** The PC's window as far as the opening cares, each element with the place it would have. */
function appWindow(mode: 'play' | 'still' = 'play') {
  document.documentElement.setAttribute('data-startup-intro', mode)
  document.body.innerHTML = `
    <div id="startup-intro"><div class="si-lockup"><div class="si-mk"></div><div class="si-nm"></div></div></div>
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand"><div class="brand-mark"></div><div class="brand-name">RAID <span class="brand-os">OS</span><span class="brand-sub"></span></div></a>
        <div class="nav-label" id="label"></div>
        <nav class="nav-list"><a class="nav-link" id="overview"></a><a class="nav-link" id="below-the-window"></a></nav>
      </aside>
      <header class="topbar"><button id="search"></button><button id="news"></button><button id="hidden"></button></header>
      <div class="mask-badge" id="mask"></div><div class="nap" id="nap"></div>
      <main class="content"><div class="page">
        <header class="page-header" id="head"></header>
        <div class="overview-rows" id="rows">
          <div class="row" id="cards"><div class="card" id="card-1"></div><div class="card" id="card-2"></div></div>
          <div class="card" id="big"></div>
          <div class="card" id="under-the-window"></div>
        </div>
      </div></main>
    </div>
    <div class="gear-helmet" id="helmet"></div>`
  const places: Array<[string, DOMRect]> = [
    ['.si-mk', box(700, 400, 64, 64)], ['.si-nm', box(774, 420, 124, 25)],
    ['.sidebar', box(0, 0, 238, 900)], ['.brand-mark', box(22, 26, 38, 38)], ['.brand-name', box(71, 29, 138, 32)], ['.brand-sub', box(71, 48, 138, 12)],
    ['#label', box(14, 86, 209, 29)], ['#overview', box(14, 115, 209, 42)], ['#below-the-window', box(14, 1000, 209, 42)],
    ['.topbar', box(238, 0, 1362, 68)], ['#search', box(266, 14, 520, 39)], ['#news', box(1283, 15, 38, 38)],
    ['#mask', box(150, 110, 60, 60)], ['#helmet', box(150, 110, 60, 60)], ['#nap', box(0, 0, 1600, 900)],
    ['.content', box(0, 0, 1600, 1067)], ['.page', box(268, 88, 1302, 937)], ['#head', box(268, 88, 1302, 65)], ['#rows', box(268, 179, 1302, 846)],
    ['#cards', box(268, 179, 1302, 168)], ['#card-1', box(268, 179, 640, 168)], ['#card-2', box(920, 179, 640, 168)],
    ['#big', box(268, 361, 900, 500)], ['#under-the-window', box(268, 950, 900, 100)],
  ]
  for (const [selector, place] of places) {
    (document.querySelector(selector) as HTMLElement).getBoundingClientRect = () => place
  }
  Element.prototype.getAnimations = () => []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 1067 })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => 1600 })
  return document.getElementById('startup-intro')!
}

/** The phone's window: its top bar has the emblem and no name, the tab bar stands at the bottom. */
function phoneWindow(mode: 'play' | 'still' = 'play') {
  document.documentElement.setAttribute('data-startup-intro', mode)
  document.body.innerHTML = `
    <div id="startup-intro"><div class="si-lockup"><div class="si-mk"></div><div class="si-nm"></div></div></div>
    <div class="app-shell">
      <aside class="sidebar mobile-tabbar"><a class="nav-link mobile-tab" id="tab-1"></a><button class="nav-link mobile-tab" id="tab-5"></button></aside>
      <header class="topbar mobile-topbar">
        <a class="brand mobile-brand"><div class="brand-mark"></div></a>
        <div class="mode-switch" id="modes"></div><button class="profile-chip" id="profile"></button>
      </header>
      <main class="content"><div class="page"><header class="page-header" id="head"></header><div class="card" id="big"></div></div></main>
    </div>`
  const places: Array<[string, DOMRect]> = [
    ['.si-mk', box(162, 370, 65, 65)], ['.si-nm', box(147, 444, 96, 19)],
    ['.sidebar', box(0, 782, 390, 62)], ['#tab-1', box(6, 788, 75, 48)], ['#tab-5', box(309, 788, 75, 48)],
    ['.topbar', box(0, 0, 390, 54)], ['.mobile-brand', box(10, 7, 40, 40)], ['.brand-mark', box(10, 7, 40, 40)],
    ['#modes', box(58, 10, 200, 34)], ['#profile', box(292, 7, 40, 40)],
    ['.content', box(0, 0, 390, 900)], ['.page', box(10, 66, 370, 800)], ['#head', box(10, 66, 370, 60)], ['#big', box(10, 140, 370, 500)],
  ]
  for (const [selector, place] of places) {
    (document.querySelector(selector) as HTMLElement).getBoundingClientRect = () => place
  }
  Element.prototype.getAnimations = () => []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 900 })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => 390 })
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
  document.documentElement.removeAttribute('data-startup-intro')
  document.documentElement.style.removeProperty('scrollbar-gutter')
  delete (Element.prototype as Partial<Element>).animate
  delete (Element.prototype as Partial<Element>).getAnimations
  Reflect.deleteProperty(document.documentElement, 'scrollHeight')
  Reflect.deleteProperty(document.documentElement, 'clientWidth')
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the app opens as the site does: the emblem goes to its place (owner, 06.11.2026)', () => {
  it('the emblem lands exactly on the one in the menu, which takes over as it arrives', () => {
    const intro = appWindow()
    const { moves } = recordMoves()
    void openApp(intro)
    const mark = intro.querySelector('.si-mk')
    const tile = document.querySelector('.brand-mark')
    const flight = moves.find((move) => move.element === mark && String(move.frames[1].transform).startsWith('translate'))!
    expect(flight.frames[1].transform).toBe(`translate(${22 - 700}px, ${26 - 400}px) scale(${38 / 64}, ${38 / 64})`)
    expect(flight.options.duration).toBe(FLIGHT_MS)
    expect(moves.find((move) => move.element === tile && move.frames[0].opacity === 0)!.options.duration).toBe(LANDS_MS)
    expect(moves.find((move) => move.element === mark && move.frames[1].opacity === 0)!.options.delay).toBe(LANDS_MS)
  })

  it('the menu, the top bar and the page come up; what is hidden or under the window does not', () => {
    const intro = appWindow()
    const { moves } = recordMoves()
    void openApp(intro)
    const moved = new Set(moves.map((move) => (move.element as HTMLElement).id))
    for (const id of ['label', 'overview', 'search', 'news', 'head', 'card-1', 'card-2', 'big']) expect(moved.has(id), id).toBe(true)
    for (const id of ['below-the-window', 'hidden', 'under-the-window', 'cards', 'rows']) expect(moved.has(id), id).toBe(false)
  })

  it('a decoration beside the menu comes by opacity alone, a whole-window one stands', () => {
    const intro = appWindow()
    const { moves } = recordMoves()
    void openApp(intro)
    for (const id of ['mask', 'helmet']) {
      const decor = moves.filter((move) => (move.element as HTMLElement).id === id)
      expect(decor, id).toHaveLength(1)
      expect(decor[0]!.frames[0]).toEqual({ opacity: 0 })
    }
    expect(moves.some((move) => (move.element as HTMLElement).id === 'nap')).toBe(false)
  })

  it('at rest the window is what it was: nothing held, nothing left behind', async () => {
    const intro = appWindow()
    const { moves, finish } = recordMoves()
    prepareAppOpening()
    expect(document.documentElement.style.getPropertyValue('scrollbar-gutter')).toBe('stable')
    const children = document.body.childElementCount
    const opening = openApp(intro)!
    expect(document.body.childElementCount).toBe(children + 1)
    finish()
    await opening
    expect(moves.every((move) => move.cancel.mock.calls.length === 1)).toBe(true)
    expect(document.body.childElementCount).toBe(children)
    expect(document.documentElement.style.getPropertyValue('scrollbar-gutter')).toBe('')
  })

  it('a window hidden all along is released too', async () => {
    vi.useFakeTimers()
    const intro = appWindow()
    const { moves } = recordMoves()
    const opening = openApp(intro)!
    await vi.advanceTimersByTimeAsync(10_000)
    await opening
    expect(moves.every((move) => move.cancel.mock.calls.length === 1)).toBe(true)
  })

  it.each([
    ['a reload in the same window', () => { document.documentElement.setAttribute('data-startup-intro', 'still') }],
    ['motion turned off', () => { vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })) }],
    ['the phone, which has no menu', () => { document.querySelector('.sidebar')!.remove() }],
    ['a browser that cannot animate', () => { delete (Element.prototype as Partial<Element>).animate }],
  ])('%s: it says so and the intro fades', (_name, change) => {
    const intro = appWindow()
    recordMoves()
    document.documentElement.style.setProperty('scrollbar-gutter', 'stable')
    change()
    expect(openApp(intro)).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('scrollbar-gutter')).toBe('')
  })

  it('no second show after a reload: nothing is prepared', () => {
    appWindow('still')
    prepareAppOpening()
    expect(document.documentElement.style.getPropertyValue('scrollbar-gutter')).toBe('')
  })

  it('a window with no scrollbar is not given a place for one', () => {
    appWindow()
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => window.innerHeight })
    prepareAppOpening()
    expect(document.documentElement.style.getPropertyValue('scrollbar-gutter')).toBe('')
  })
})

describe('the phone opens the same way (owner, 07.11.2026: «эта эмблема переносится туда»)', () => {
  it('the emblem lands on the one in the top bar, up and to the left, and the name just goes', () => {
    const intro = phoneWindow()
    const { moves } = recordMoves()
    expect(openApp(intro)).toBeDefined()
    const mark = intro.querySelector('.si-mk')
    const flight = moves.find((move) => move.element === mark && String(move.frames[1].transform).startsWith('translate'))!
    expect(flight.frames[1].transform).toBe(`translate(${10 - 162}px, ${7 - 370}px) scale(${40 / 65}, ${40 / 65})`)
    const word = moves.filter((move) => move.element === intro.querySelector('.si-nm'))
    expect(word).toHaveLength(1)
    expect(word[0]!.frames[1]).toEqual({ opacity: 0 })
  })

  it('the top bar, the tabs and the page come up; the emblem itself only takes over', () => {
    const intro = phoneWindow()
    const { moves } = recordMoves()
    void openApp(intro)
    const moved = new Set(moves.map((move) => (move.element as HTMLElement).id))
    for (const id of ['modes', 'profile', 'tab-1', 'tab-5', 'head', 'big']) expect(moved.has(id), id).toBe(true)
    expect(moves.some((move) => move.element === document.querySelector('.mobile-brand'))).toBe(false)
    const delayOf = (id: string) => moves.find((move) => (move.element as HTMLElement).id === id)!.options.delay as number
    expect(delayOf('tab-5')).toBeGreaterThan(delayOf('tab-1'))
  })

  it('two stitches run, under the top bar and over the tabs', () => {
    const intro = phoneWindow()
    recordMoves()
    void openApp(intro)
    const tops = [...intro.querySelectorAll('canvas')].map((canvas) => canvas.style.top)
    expect(tops).toEqual([`${54 - 0.5 - 3}px`, `${782 + 0.5 - 3}px`])
  })

  it('at rest nothing is held and nothing left behind', async () => {
    const intro = phoneWindow()
    const { moves, finish } = recordMoves()
    const opening = openApp(intro)!
    finish()
    await opening
    for (const move of moves) expect(move.cancel).toHaveBeenCalled()
    expect(document.body.querySelector(':scope > div[aria-hidden="true"]')).toBeNull()
  })

  it('the sign-in window over the shell keeps the fade: where the emblem lands is hidden', () => {
    const intro = phoneWindow()
    const { moves } = recordMoves()
    document.body.insertAdjacentHTML('beforeend', '<div class="registration-overlay account-gate"></div>')
    expect(openApp(intro)).toBeUndefined()
    expect(moves).toHaveLength(0)
  })

  it('a reload in the same window keeps the fade', () => {
    const intro = phoneWindow('still')
    recordMoves()
    expect(openApp(intro)).toBeUndefined()
  })
})

describe('where the name lands', () => {
  it('the two words, at the height of their capitals', () => {
    appWindow()
    const name = document.querySelector('.brand-name')!
    const range = { setStartBefore: vi.fn(), setEndAfter: vi.fn(), getBoundingClientRect: () => box(71, 29, 62, 19) }
    vi.spyOn(document, 'createRange').mockReturnValue(range as unknown as Range)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ fontSize: '13px', letterSpacing: '1px' } as unknown as CSSStyleDeclaration)
    const target = brandNameBox(name, document)!
    expect(range.setEndAfter).toHaveBeenCalledWith(name.querySelector('.brand-os'))
    expect(target.left).toBe(71)
    expect(target.width).toBe(61)
    expect(target.height).toBeCloseTo(9.49, 1)
    expect(target.top + target.height / 2).toBeCloseTo(29 + 19 / 2, 5)
  })

  it('no such text: nothing to land on', () => {
    appWindow()
    const name = document.createElement('div')
    expect(brandNameBox(name, document)).toBeUndefined()
  })
})

describe('what of the page comes up on its own', () => {
  it('a row is opened into its cards, in reading order, what is under the window stays', () => {
    appWindow()
    const ids = pagePieces(document.querySelector('.page')!, 900).map((piece) => piece.id)
    expect(ids).toEqual(['head', 'card-1', 'card-2', 'big'])
  })

  it('never more than the limit', () => {
    appWindow()
    expect(pagePieces(document.querySelector('.page')!, 900, 2).map((piece) => piece.id)).toEqual(['head', 'card-1'])
  })
})
