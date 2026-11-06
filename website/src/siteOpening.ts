/**
 * The home page's opening after the start intro (owner, 06.11.2026: «этот значок переместится в то место, где у нас
 * сейчас на сайте слева сверху [...] чтобы вся страница собралась в таком же стиле, с такой же анимацией»).
 *
 * The emblem flies to its place in the header and the page puts itself together with the intro's own moves: a stitch
 * that runs (under the header, round the trailer, under the big name), letters rising out of a slot one by one, a thud
 * with a ring where something lands. All of it is opacity and transform, which the graphics process runs by itself.
 *
 * Nothing here hides the page by a style: the pieces are held by animations that start in the frame the intro opens and
 * are dropped at the end, so a page where this never ran, a reader without scripts or a search engine (see
 * startupIntroHead.js) simply has the page. At rest the page is exactly what it was.
 */

/** The intro's own curve (--si-out in src/startup/intro.css). */
const EASE = 'cubic-bezier(.23, 1, .32, 1)'
const TRAVEL = 'cubic-bezier(.65, 0, .15, 1)'

export const FLIGHT_MS = 720
/** From the start of the flight to the page at rest. */
export const OPENING_MS = 1560
/** The window was hidden and the animations never ran: the page is released anyway. */
const CEILING_MS = OPENING_MS + 800

/** The big name, in the units of public/brand/wordmark.svg (website/src/siteOpening.test.ts checks them against it). */
export const WORDMARK = {
  left: -4,
  top: -4,
  width: 657.22,
  height: 189.5,
  letters: [[9.15, 81.9], [112.6, 187], [221.6, 246.2], [286.8, 356.4], [442.9, 514.6], [550.1, 615.9]],
  /** The band of the letters, of the stitch under them and of the line under it. */
  lettersBand: [-4, 128],
  stitchBand: [138, 149],
  lineBand: [156, 185.5],
}

type Point = [number, number]
type Path = { at: (length: number) => Point; length: number }

/** The logo's dash: 6 on, 4.5 off. */
const DASH_STEP = 10.5
const DASH_SHARE = 0.57
/** Dashes that appear together: the stitch goes faster than a dash a frame. */
const DASHES_PER_PICTURE = 12
const STROKE_ROOM = 2.2

export function straightLine(from: Point, to: Point): Path {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  return { length, at: (at) => [from[0] + (to[0] - from[0]) * (at / length), from[1] + (to[1] - from[1]) * (at / length)] }
}

/** Round a box from the top centre, clockwise, the way the stitch goes round the patch. */
export function roundBox(left: number, top: number, width: number, height: number, radius: number): Path {
  const arc = Math.PI * radius / 2
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
  function corner(x: number, y: number, angle: number): Point {
    return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)]
  }
  const length = sides.reduce((sum, [side]) => sum + side, 0)
  return {
    length,
    at: (at) => {
      let left_ = at % length
      for (const [side, point] of sides) {
        if (left_ <= side) return point(left_)
        left_ -= side
      }
      return [left + width / 2, top]
    },
  }
}

/**
 * The stitch of src/startup/intro.css (`.si-d`, `.si-hot`), in small pictures of their own for the reason given in
 * scripts/startup-intro.mjs. `hotOnly`: the bright head with no thin line left behind, over a line already in the artwork.
 */
export function drawStitch(parent: Element, path: Path, startMs: number, ms: number, hotOnly = false) {
  const doc = parent.ownerDocument
  const count = Math.max(1, Math.round(path.length / DASH_STEP))
  const step = path.length / count
  for (let first = 0; first < count; first += DASHES_PER_PICTURE) {
    const dashes: Array<[Point, Point]> = []
    for (let i = first; i < Math.min(first + DASHES_PER_PICTURE, count); i++) {
      dashes.push([path.at(i * step), path.at((i + DASH_SHARE) * step)])
    }
    const xs = dashes.flat().map((point) => point[0])
    const ys = dashes.flat().map((point) => point[1])
    const left = Math.min(...xs) - STROKE_ROOM
    const top = Math.min(...ys) - STROKE_ROOM
    const width = Math.max(...xs) + STROKE_ROOM - left
    const height = Math.max(...ys) + STROKE_ROOM - top
    const d = dashes.map(([a, b]) => `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`).join('')
    for (const name of hotOnly ? ['si-d si-hot'] : ['si-d', 'si-d si-hot']) {
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('class', name)
      svg.setAttribute('viewBox', `${left.toFixed(1)} ${top.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`)
      svg.setAttribute('style', `left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${width.toFixed(1)}px;height:${height.toFixed(1)}px;--k:${Math.round(startMs + first / count * ms)}`)
      const line = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
      line.setAttribute('d', d)
      svg.append(line)
      parent.append(svg)
    }
  }
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
  if (!view || !hero || !seen(tile) || !seen(mark) || !seen(word) || typeof tile.animate !== 'function') return undefined

  const moves: Animation[] = []
  const move = (element: Element, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const animation = element.animate(frames, { fill: 'backwards', ...options })
    moves.push(animation)
    return animation
  }
  const rise = (element: Element, delay: number, distance = 16, duration = 480) => move(element, [
    { opacity: 0, transform: `translateY(${distance}px)` },
    { opacity: 1, transform: 'none' },
  ], { delay, duration, easing: EASE })
  const hold = (element: Element, duration: number) => move(element, [{ opacity: 0 }, { opacity: 0 }], { duration })
  const ring = (parent: Element, left: number, top: number, width: number, height: number, radius: string, reach: number, delay: number) => {
    const shock = doc.createElement('div')
    shock.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;border:1.5px solid #a9b973;border-radius:${radius};opacity:0`
    parent.append(shock)
    move(shock, [
      { opacity: 0.85, transform: 'none' },
      { opacity: 0, transform: `scale(${1 + reach * 2 / width}, ${1 + reach * 2 / height})` },
    ], { delay, duration: 520, easing: EASE, fill: 'none' })
  }

  // ---- The emblem. The ground under it goes, and it flies to where the header's own emblem stands.
  intro.style.animation = 'none'
  intro.style.background = 'none'
  const ground = doc.createElement('div')
  ground.style.cssText = 'position:absolute;inset:0;background:#0d1110'
  intro.prepend(ground)
  move(ground, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease', fill: 'forwards' })

  const landed = tile.getBoundingClientRect()
  const fly = (element: HTMLElement, target: DOMRect) => {
    const from = element.getBoundingClientRect()
    const to = `translate(${target.left - from.left}px, ${target.top - from.top}px) scale(${target.width / from.width}, ${target.height / from.height})`
    element.style.transformOrigin = '0 0'
    move(element, [{ transform: 'none' }, { transform: to }], { duration: FLIGHT_MS, easing: TRAVEL, fill: 'forwards' })
  }
  fly(mark, landed)
  hold(tile, FLIGHT_MS - 30)
  move(mark, [{ opacity: 1 }, { opacity: 0 }], { delay: FLIGHT_MS - 30, duration: 90, fill: 'forwards' })
  move(tile, [{ transform: 'scale(.9)' }, { transform: 'none' }], { delay: FLIGHT_MS - 30, duration: 360, easing: EASE, fill: 'none' })
  ring(intro, landed.left, landed.top, landed.width, landed.height, '24%', 12, FLIGHT_MS - 30)

  const name = doc.querySelector('.site-header .brand-logo-name')
  if (seen(name)) {
    const box = name.getBoundingClientRect()
    fly(word, box)
    hold(name, FLIGHT_MS - 30)
    move(word, [{ opacity: 1 }, { opacity: 0 }], { delay: FLIGHT_MS - 30, duration: 90, fill: 'forwards' })
  } else {
    move(word, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' })
  }
  const sub = doc.querySelector('.site-header .brand-sub')
  if (seen(sub)) rise(sub, FLIGHT_MS - 20, 10, 420)

  // ---- The header: from the landed emblem a stitch runs along its lower edge, and its buttons rise out of that line
  // as the stitch passes under them.
  const header = doc.querySelector('.site-header')
  const bar = doc.querySelector<HTMLElement>('.site-header .container')
  const seams = doc.createElement('div')
  seams.style.cssText = 'position:absolute;inset:0'
  intro.append(seams)
  const seamStart = FLIGHT_MS - 60
  const seamMs = 420
  if (header && bar) {
    bar.style.clipPath = 'inset(0)'
    const y = header.getBoundingClientRect().bottom - 0.5
    const origin = landed.left + landed.width / 2
    const width = doc.documentElement.clientWidth
    const reach = Math.max(origin, width - origin)
    const seam = (to: number) => {
      const share = Math.abs(to - origin) / reach
      if (share > 0) drawStitch(seams, straightLine([origin, y], [to, y]), seamStart, seamMs * share)
    }
    seam(0)
    seam(width)
    bar.querySelectorAll('.site-nav a, .header-actions > *').forEach((item) => {
      if (!seen(item)) return
      const passed = (item.getBoundingClientRect().left - origin) / reach
      move(item, [{ transform: 'translateY(58px)' }, { transform: 'none' }], { delay: seamStart + passed * seamMs, duration: 460, easing: EASE })
    })
  }

  // ---- The page itself. Its pieces stand in a layer of the page, so a visitor who scrolls at once scrolls them too.
  const page = doc.createElement('div')
  page.setAttribute('aria-hidden', 'true')
  page.style.cssText = `position:absolute;left:0;top:0;width:100%;height:${doc.documentElement.scrollHeight}px;overflow:hidden;z-index:25;pointer-events:none`
  doc.body.append(page)
  const onPage = (box: DOMRect) => ({ left: box.left + view.scrollX, top: box.top + view.scrollY, width: box.width, height: box.height })

  const eyebrow = hero.querySelector('.eyebrow')
  if (seen(eyebrow)) rise(eyebrow, 260)

  // The big name: its letters rise out of a slot one by one, like the intro's, then its stitch runs and its line rises.
  const big = hero.querySelector<HTMLImageElement>('.hero-wordmark img')
  if (seen(big)) {
    const box = onPage(big.getBoundingClientRect())
    const unit = box.width / WORDMARK.width
    const slot = (x0: number, x1: number, y0: number, y1: number) => {
      const element = doc.createElement('span')
      const left = (x0 - WORDMARK.left) * unit
      const top = (y0 - WORDMARK.top) * unit
      element.style.cssText = `position:absolute;overflow:hidden;left:${box.left + left}px;top:${box.top + top}px;width:${(x1 - x0) * unit}px;height:${(y1 - y0) * unit}px`
      const copy = doc.createElement('img')
      copy.src = big.currentSrc || big.src
      copy.alt = ''
      // Only its own band of the picture travels: what stands under it in the artwork must not come through the slot.
      const inset = `${top}px ${box.width - left - (x1 - x0) * unit}px ${box.height - top - (y1 - y0) * unit}px ${left}px`
      copy.style.cssText = `position:absolute;display:block;max-width:none;left:${-left}px;top:${-top}px;width:${box.width}px;height:${box.height}px;clip-path:inset(${inset})`
      element.append(copy)
      page.append(element)
      return { element, copy, height: (y1 - y0) * unit }
    }
    const [bandTop, bandBottom] = WORDMARK.lettersBand
    WORDMARK.letters.forEach(([x0, x1], i) => {
      const letter = slot(x0 - 1, x1 + 1, bandTop, bandBottom)
      move(letter.copy, [{ transform: `translateY(${letter.height * 1.12}px)` }, { transform: 'none' }], { delay: 320 + i * 54, duration: 480, easing: EASE })
    })
    const stitch = slot(WORDMARK.left, WORDMARK.left + WORDMARK.width, WORDMARK.stitchBand[0], WORDMARK.stitchBand[1])
    move(stitch.element, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { delay: 500, duration: 380, easing: 'linear' })
    const stitchY = box.top + (143.5 - WORDMARK.top) * unit
    drawStitch(page, straightLine([box.left + 6 * unit, stitchY], [box.left + 653 * unit, stitchY]), 500, 380, true)
    const line = slot(WORDMARK.left, WORDMARK.left + WORDMARK.width, WORDMARK.lineBand[0], WORDMARK.lineBand[1])
    move(line.copy, [{ transform: `translateY(${line.height * 1.12}px)` }, { transform: 'none' }], { delay: 700, duration: 480, easing: EASE })
    hold(big, OPENING_MS)
  }
  const lead = hero.querySelector('.hero-lead')
  if (seen(lead)) rise(lead, 760)

  // The trailer, as the patch: a stitch goes round its place, it comes up inside that, a thud and a ring.
  const stage = hero.querySelector('.hero-stage')
  const player = hero.querySelector('.trailer')
  const frames = doc.createElement('div')
  page.append(frames)
  if (seen(stage) && seen(player)) {
    const box = onPage(player.getBoundingClientRect())
    const room = 9
    drawStitch(frames, roundBox(box.left - room, box.top - room, box.width + room * 2, box.height + room * 2, 27), 260, 520)
    move(stage, [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { delay: 560, duration: 420, easing: EASE })
    ring(page, box.left, box.top, box.width, box.height, '18px', 22, 900)
  }

  // What is left comes up in reading order.
  hero.querySelectorAll('.hero-actions.center > *, .platforms, .hero-note').forEach((element, i) => {
    if (seen(element)) rise(element, 900 + i * 54)
  })
  const cookies = doc.querySelector('.cookie-notice')
  if (seen(cookies)) rise(cookies, 1040, 18)
  doc.querySelectorAll('.route-view > :not(.hero)').forEach((section) => {
    if (seen(section) && section.getBoundingClientRect().top < view.innerHeight) rise(section, 1040, 18)
  })

  // The stitches were only how it was put together: at rest the page has its own lines.
  for (const stitches of [seams, frames]) {
    move(stitches, [{ opacity: 1 }, { opacity: 0 }], { delay: OPENING_MS - 340, duration: 340, easing: 'ease', fill: 'forwards' })
  }

  const release = () => {
    moves.forEach((animation) => animation.cancel())
    page.remove()
    bar?.style.removeProperty('clip-path')
  }
  const finished = Promise.allSettled(moves.map((animation) => animation.finished))
  const ceiling = new Promise<void>((resolve) => { view.setTimeout(resolve, CEILING_MS) })
  return Promise.race([finished, ceiling]).then(release, release)
}
