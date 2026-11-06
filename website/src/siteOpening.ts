import { cubicBezier } from '../../src/shared/motion'

/**
 * The home page's opening after the start intro (owner, 06.11.2026: «этот значок переместится в то место, где у нас
 * сейчас на сайте слева сверху [...] чтобы вся страница собралась в таком же стиле, с такой же анимацией»; then:
 * «каждое движение, каждая анимация» must be smooth).
 *
 * The emblem flies to its place in the header and the page puts itself together with the intro's own moves: a stitch
 * that runs (under the header, round the trailer, under the big name), letters rising out of a slot one by one.
 *
 * What keeps it smooth:
 * - everything that moves is opacity or transform, which the graphics process runs by itself;
 * - the stitches are drawn on small canvases, a little further each frame, so a stitch runs at the screen's own rate
 *   instead of jumping from one picture to the next;
 * - curves that start gently: a piece never covers a large part of its way in the first frames;
 * - what is costly to redraw every frame is off while it runs (startupIntroSite.css), the trailer starts when it is
 *   seen, and the page's layout does not change when it opens.
 *
 * Nothing here hides the page by a style: the pieces are held by animations that start in the frame the intro opens and
 * are dropped at the end, so a page where this never ran, a reader without scripts or a search engine (see
 * startupIntroHead.js) simply has the page. At rest the page is exactly what it was.
 */

const RISE = 'cubic-bezier(.2, .7, .2, 1)'
const TRAVEL = 'cubic-bezier(.5, 0, .12, 1)'

export const FLIGHT_MS = 800
/** From the start of the flight to the page at rest. */
export const OPENING_MS = 1650
/** The window was hidden and the animations never ran: the page is released anyway. */
const CEILING_MS = OPENING_MS + 800

/** The big name, in the units of public/brand/wordmark.svg (website/src/siteOpening.test.ts checks them against it). */
export const WORDMARK = {
  left: -4,
  top: -4,
  width: 657.22,
  height: 189.5,
  letters: [[9.15, 81.9], [112.6, 187], [221.6, 246.2], [286.8, 356.4], [442.9, 514.6], [550.1, 615.9]],
  /** The band of the letters and of the line under them. */
  lettersBand: [-4, 128],
  lineBand: [156, 185.5],
  /** The stitch between them: where the artwork has it and its dash. */
  stitch: { x0: 2, x1: 649.22, y: 143.5, on: 10, off: 7, width: 2.5, colour: 'rgb(212 224 166 / 72%)' },
}

type Point = [number, number]
type Path = { at: (length: number) => Point; length: number }

export function straightLine(from: Point, to: Point): Path {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  return { length, at: (at) => [from[0] + (to[0] - from[0]) * (at / length), from[1] + (to[1] - from[1]) * (at / length)] }
}

/** Round a box from the top centre, clockwise, the way the stitch goes round the patch. */
export function roundBox(left: number, top: number, width: number, height: number, radius: number): Path {
  const arc = Math.PI * radius / 2
  const corner = (x: number, y: number, angle: number): Point => [x + radius * Math.cos(angle), y + radius * Math.sin(angle)]
  const sides: Array<[number, (done: number) => Point]> = [
    [width / 2 - radius, (d) => [left + width / 2 + d, top]],
    [arc, (d) => corner(left + width - radius, top + radius, -Math.PI / 2 + d / radius)],
    [height - 2 * radius, (d) => [left + width, top + radius + d]],
    [arc, (d) => corner(left + width - radius, top + height - radius, d / radius)],
    [width - 2 * radius, (d) => [left + width - radius - d, top + height]],
    [arc, (d) => corner(left + radius, top + height - radius, Math.PI / 2 + d / radius)],
    [height - 2 * radius, (d) => [left, top + height - radius - d]],
    [arc, (d) => corner(left + radius, top + radius, Math.PI + d / radius)],
    [width / 2 - radius, (d) => [left + radius + d, top]],
  ]
  const length = sides.reduce((sum, [side]) => sum + side, 0)
  return {
    length,
    at: (at) => {
      let rest = at % length
      for (const [side, point] of sides) {
        if (rest <= side) return point(rest)
        rest -= side
      }
      return [left + width / 2, top]
    },
  }
}

/** One running stitch. */
export type Stitch = {
  path: Path
  start: number
  ms: number
  on: number
  off: number
  width: number
  colour: string
  /** The bright part just behind the head, in pixels of the path. */
  tail: number
  hotWidth: number
}

const headCurve = cubicBezier(0.3, 0.1, 0.35, 1)
/** After the head stops, how long its bright tail takes to go out. */
const HOT_FADE_MS = 320

/** How far along the path the head is, 0 before it starts. */
export function headAt(stitch: Pick<Stitch, 'start' | 'ms' | 'path'>, elapsed: number) {
  const share = (elapsed - stitch.start) / stitch.ms
  if (share <= 0) return 0
  return share >= 1 ? stitch.path.length : headCurve(share) * stitch.path.length
}

/** Draws its stitches as far as they have come. Says whether there will be anything different to draw later. */
export function drawStitches(context: CanvasRenderingContext2D, width: number, height: number, stitches: Stitch[], elapsed: number) {
  context.clearRect(0, 0, width, height)
  context.lineCap = 'butt'
  let moving = false
  for (const stitch of stitches) {
    const head = headAt(stitch, elapsed)
    const after = elapsed - stitch.start - stitch.ms
    if (after < HOT_FADE_MS) moving = true
    if (head <= 0) continue
    const step = stitch.on + stitch.off
    context.beginPath()
    for (let at = 0; at < head; at += step) {
      const [x0, y0] = stitch.path.at(at)
      const [x1, y1] = stitch.path.at(Math.min(at + stitch.on, head))
      context.moveTo(x0, y0)
      context.lineTo(x1, y1)
    }
    context.strokeStyle = stitch.colour
    context.lineWidth = stitch.width
    context.stroke()
    const fade = after <= 0 ? 1 : 1 - after / HOT_FADE_MS
    if (fade <= 0) continue
    context.strokeStyle = '#fbffe9'
    context.lineWidth = stitch.hotWidth
    for (let at = Math.max(0, Math.floor((head - stitch.tail) / step)) * step; at < head; at += step) {
      const glow = (1 - (head - at) / stitch.tail) * fade
      if (glow <= 0) continue
      const [x0, y0] = stitch.path.at(at)
      const [x1, y1] = stitch.path.at(Math.min(at + stitch.on, head))
      context.globalAlpha = glow
      context.beginPath()
      context.moveTo(x0, y0)
      context.lineTo(x1, y1)
      context.stroke()
    }
    context.globalAlpha = 1
  }
  return moving
}

const seen = (element: Element | null): element is HTMLElement => {
  if (!element) return false
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0
}

/**
 * The page has just been put under the intro. Its usual entrance would be spent there unseen, and its places must be at
 * rest when the emblem measures them, so it stands finished at once: drawn and ready behind the intro.
 */
export function settleUnderIntro(doc: Document = document) {
  if (typeof doc.documentElement.getAnimations !== 'function') return
  doc.querySelectorAll('.route-view, .stagger, .cookie-notice').forEach((element) => {
    element.getAnimations().forEach((animation) => animation.finish())
  })
}

/** The trailer waits at its first frame, to start when it is seen and not to be decoded for nobody. */
export function holdTrailer(doc: Document = document) {
  const video = doc.querySelector<HTMLVideoElement>('.route-view .hero video')
  if (!video) return
  video.pause()
  if (video.readyState > 0) video.currentTime = 0
}

/**
 * Called by `endStartupIntro` in the frame the intro opens. Returns when the page is at rest, or nothing when it cannot
 * do this here: the intro then fades as it does in the app.
 */
export function openSite(intro: HTMLElement, doc: Document = document): Promise<void> | undefined {
  const view = doc.defaultView
  const hero = doc.querySelector('.route-view .hero')
  const tile = doc.querySelector('.site-header .brand-logo-tile')
  const mark = intro.querySelector<HTMLElement>('.si-mk')
  const word = intro.querySelector<HTMLElement>('.si-nm')
  const video = doc.querySelector<HTMLVideoElement>('.route-view .hero video')
  const startTrailer = () => { void video?.play()?.catch(() => { /* the player shows its own play button */ }) }
  if (!view || !hero || !seen(tile) || !seen(mark) || !seen(word) || typeof tile.animate !== 'function') {
    startTrailer()
    return undefined
  }

  const moves: Animation[] = []
  const move = (element: Element, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const animation = element.animate(frames, { fill: 'backwards', ...options })
    moves.push(animation)
    return animation
  }
  const rise = (element: Element, delay: number, distance = 14, duration = 560) => move(element, [
    { opacity: 0, transform: `translateY(${distance}px)` },
    { opacity: 1, transform: 'translateY(0)' },
  ], { delay, duration, easing: RISE })
  const hold = (element: Element, duration: number) => move(element, [{ opacity: 0 }, { opacity: 0 }], { duration })
  const dpr = Math.min(view.devicePixelRatio || 1, 2)
  const canvases: Array<{ context: CanvasRenderingContext2D; width: number; height: number; stitches: Stitch[]; moving: boolean }> = []
  const canvas = (parent: Element, left: number, top: number, width: number, height: number, stitches: Stitch[]) => {
    const element = doc.createElement('canvas')
    element.width = Math.ceil(width * dpr)
    element.height = Math.ceil(height * dpr)
    element.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`
    parent.append(element)
    const context = typeof element.getContext === 'function' ? element.getContext('2d') : null
    if (context) {
      context.scale(dpr, dpr)
      canvases.push({ context, width, height, stitches, moving: true })
    }
  }

  // ---- The emblem. The ground under it goes, and it flies to where the header's own emblem stands.
  intro.style.animation = 'none'
  intro.style.background = 'none'
  const ground = doc.createElement('div')
  ground.style.cssText = 'position:absolute;inset:0;background:#0d1110'
  intro.prepend(ground)
  move(ground, [{ opacity: 1 }, { opacity: 0 }], { duration: 460, easing: 'ease-out', fill: 'forwards' })

  const landed = tile.getBoundingClientRect()
  const fly = (element: HTMLElement, target: DOMRect) => {
    const from = element.getBoundingClientRect()
    const to = `translate(${target.left - from.left}px, ${target.top - from.top}px) scale(${target.width / from.width}, ${target.height / from.height})`
    element.style.transformOrigin = '0 0'
    move(element, [{ transform: 'translate(0, 0) scale(1, 1)' }, { transform: to }], { duration: FLIGHT_MS, easing: TRAVEL, fill: 'forwards' })
  }
  // The header's own appears under the flying one in its last moment, so there is always one and the change is not seen.
  const lands = FLIGHT_MS - 40
  const leave = (element: HTMLElement) => move(element, [{ opacity: 1 }, { opacity: 0 }], { delay: lands, duration: 120, fill: 'forwards' })
  fly(mark, landed)
  hold(tile, lands)
  leave(mark)

  const shock = doc.createElement('div')
  shock.style.cssText = `position:absolute;left:${landed.left}px;top:${landed.top}px;width:${landed.width}px;height:${landed.height}px;border:1.5px solid #a9b973;border-radius:24%;opacity:0`
  intro.append(shock)
  move(shock, [
    { opacity: 0.7, transform: 'scale(1)' },
    { opacity: 0, transform: 'scale(1.5)' },
  ], { delay: lands, duration: 620, easing: RISE, fill: 'none' })

  const name = doc.querySelector('.site-header .brand-logo-name')
  if (seen(name)) {
    fly(word, name.getBoundingClientRect())
    hold(name, lands)
    leave(word)
  } else {
    move(word, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' })
  }
  const sub = doc.querySelector('.site-header .brand-sub')
  if (seen(sub)) rise(sub, lands, 8, 500)

  // ---- The header: from the landed emblem a stitch runs along its lower edge, and its buttons rise out of that line
  // as the stitch passes under them.
  const header = doc.querySelector('.site-header')
  const bar = doc.querySelector<HTMLElement>('.site-header .container')
  const seams = doc.createElement('div')
  seams.style.cssText = 'position:absolute;inset:0'
  intro.append(seams)
  const seamStart = FLIGHT_MS - 120
  const seamMs = 520
  if (header && bar) {
    bar.style.overflow = 'clip'
    const y = header.getBoundingClientRect().bottom - 0.5
    const origin = landed.left + landed.width / 2
    const width = doc.documentElement.clientWidth
    const reach = Math.max(origin, width - origin)
    const seam = (to: number): Stitch => ({
      path: straightLine([origin, 3], [to, 3]),
      start: seamStart,
      ms: Math.max(1, seamMs * Math.abs(to - origin) / reach),
      on: 6,
      off: 4.5,
      width: 1.3,
      colour: 'rgb(176 184 150 / 55%)',
      tail: 260,
      hotWidth: 2.2,
    })
    canvas(seams, 0, y - 3, width, 6, [seam(0), seam(width)])
    bar.querySelectorAll('.site-nav a, .header-actions > *').forEach((item) => {
      if (!seen(item)) return
      const passed = (item.getBoundingClientRect().left - origin) / reach
      move(item, [{ transform: 'translateY(58px)' }, { transform: 'translateY(0)' }], { delay: seamStart + passed * seamMs * 0.8, duration: 560, easing: RISE })
    })
  }

  // ---- The page itself. Its pieces stand in a layer of the page, so a visitor who scrolls at once scrolls them too.
  const page = doc.createElement('div')
  page.setAttribute('aria-hidden', 'true')
  page.style.cssText = `position:absolute;left:0;top:0;width:100%;height:${doc.documentElement.scrollHeight}px;overflow:hidden;z-index:25;pointer-events:none`
  doc.body.append(page)
  const onPage = (box: DOMRect) => ({ left: box.left + view.scrollX, top: box.top + view.scrollY, width: box.width, height: box.height })

  const eyebrow = hero.querySelector('.eyebrow')
  if (seen(eyebrow)) rise(eyebrow, 200)

  // The big name: its letters rise out of a slot one by one, like the intro's, then its stitch runs and its line rises.
  const big = hero.querySelector<HTMLImageElement>('.hero-wordmark img')
  const bigParts = doc.createElement('div')
  page.append(bigParts)
  if (seen(big)) {
    const box = onPage(big.getBoundingClientRect())
    const unit = box.width / WORDMARK.width
    /** A band of the picture in a slot of its own, which only that band travels through. */
    const slot = (x0: number, x1: number, y0: number, y1: number) => {
      const left = (x0 - WORDMARK.left) * unit
      const top = (y0 - WORDMARK.top) * unit
      const width = (x1 - x0) * unit
      const height = (y1 - y0) * unit
      const place = doc.createElement('span')
      place.style.cssText = `position:absolute;overflow:hidden;left:${box.left + left}px;top:${box.top + top}px;width:${width}px;height:${height}px`
      const band = doc.createElement('span')
      band.style.cssText = `display:block;position:relative;overflow:hidden;width:${width}px;height:${height}px`
      const copy = doc.createElement('img')
      copy.src = big.currentSrc || big.src
      copy.alt = ''
      copy.style.cssText = `position:absolute;display:block;max-width:none;left:${-left}px;top:${-top}px;width:${box.width}px;height:${box.height}px`
      band.append(copy)
      place.append(band)
      bigParts.append(place)
      return { band, height }
    }
    const up = (part: { band: HTMLElement; height: number }, delay: number) => move(part.band, [
      { transform: `translateY(${part.height * 1.06}px)` },
      { transform: 'translateY(0)' },
    ], { delay, duration: 600, easing: RISE })
    const [bandTop, bandBottom] = WORDMARK.lettersBand
    WORDMARK.letters.forEach(([x0, x1], i) => up(slot(x0 - 1, x1 + 1, bandTop, bandBottom), 260 + i * 50))
    const { stitch } = WORDMARK
    canvas(bigParts, box.left, box.top + (stitch.y - WORDMARK.top) * unit - 4, box.width, 8, [{
      path: straightLine([(stitch.x0 - WORDMARK.left) * unit, 4], [(stitch.x1 - WORDMARK.left) * unit, 4]),
      start: 440,
      ms: 480,
      on: stitch.on * unit,
      off: stitch.off * unit,
      width: stitch.width * unit,
      colour: stitch.colour,
      tail: 150,
      hotWidth: 2.6,
    }])
    up(slot(WORDMARK.left, WORDMARK.left + WORDMARK.width, WORDMARK.lineBand[0], WORDMARK.lineBand[1]), 640)
    // All of it has arrived: the picture itself takes over, where its parts stand, pixel for pixel.
    void hold(big, 1260).finished.then(() => bigParts.remove(), () => bigParts.remove())
  }
  const lead = hero.querySelector('.hero-lead')
  if (seen(lead)) rise(lead, 700)

  // The trailer, as the patch: a stitch goes round its place, it comes up inside that and starts to play.
  const stage = hero.querySelector('.hero-stage')
  const player = hero.querySelector('.trailer')
  const frames = doc.createElement('div')
  page.append(frames)
  if (seen(stage) && seen(player)) {
    const box = onPage(player.getBoundingClientRect())
    const room = 9
    const margin = 4
    canvas(frames, box.left - room - margin, box.top - room - margin, box.width + (room + margin) * 2, box.height + (room + margin) * 2, [{
      path: roundBox(margin, margin, box.width + room * 2, box.height + room * 2, 27),
      start: 180,
      ms: 700,
      on: 7,
      off: 5,
      width: 1.4,
      colour: 'rgb(176 184 150 / 60%)',
      tail: 340,
      hotWidth: 2.4,
    }])
    rise(stage, 440, 20, 720)
  }
  // It starts as it begins to show, so a visitor sees it from its first frame.
  view.setTimeout(startTrailer, 440)

  // What is left comes up in reading order.
  hero.querySelectorAll('.hero-actions.center > *, .platforms, .hero-note').forEach((element, i) => {
    if (seen(element)) rise(element, 820 + i * 60)
  })
  const cookies = doc.querySelector('.cookie-notice')
  if (seen(cookies)) rise(cookies, 1000, 16)
  doc.querySelectorAll('.route-view > :not(.hero)').forEach((section) => {
    if (seen(section) && section.getBoundingClientRect().top < view.innerHeight) rise(section, 1000, 16)
  })

  // The stitches were only how it was put together: at rest the page has its own lines.
  for (const stitches of [seams, frames]) {
    move(stitches, [{ opacity: 1 }, { opacity: 0 }], { delay: OPENING_MS - 380, duration: 380, easing: 'ease-in-out', fill: 'forwards' })
  }

  // The stitches run on the same clock as everything else, one small step on every frame of the screen.
  const startedAt = doc.timeline?.currentTime
  let firstFrame = typeof startedAt === 'number' ? startedAt : null
  let released = false
  const frame = (now: number) => {
    if (released) return
    if (firstFrame === null) firstFrame = now
    const elapsed = now - firstFrame
    let moving = false
    for (const item of canvases) {
      if (!item.moving) continue
      item.moving = drawStitches(item.context, item.width, item.height, item.stitches, elapsed)
      moving = moving || item.moving
    }
    if (moving) view.requestAnimationFrame(frame)
  }
  if (canvases.length) view.requestAnimationFrame(frame)

  const release = () => {
    released = true
    moves.forEach((animation) => animation.cancel())
    page.remove()
    bar?.style.removeProperty('overflow')
  }
  const finished = Promise.allSettled(moves.map((animation) => animation.finished))
  const ceiling = new Promise<void>((resolve) => { view.setTimeout(resolve, CEILING_MS) })
  return Promise.race([finished, ceiling]).then(release, release)
}
