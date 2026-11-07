import { beginOpening, frameStitch, LANDS_MS, RISE, seamStitch, seen, straightLine } from '../../src/startup/opening'

/**
 * The home page's opening after the start intro (owner, 06.11.2026: «этот значок переместится в то место, где у нас
 * сейчас на сайте слева сверху [...] чтобы вся страница собралась в таком же стиле, с такой же анимацией»), on what it
 * shares with the app (src/startup/opening.ts): a stitch under the header, round the trailer and under the big name, letters
 * rising out of a slot one by one.
 *
 * What is costly to redraw every frame is off while it runs (startupIntroSite.css), the trailer starts when it is seen, and
 * the page's layout does not change when it opens. A reader without scripts or a search engine (startupIntroHead.js) simply
 * has the page.
 */

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
 * do this here: the intro then fades as it does in the app's other screens.
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

  const { canvas, hold, landName, landPatch, move, rise, run, stitchesGo } = beginOpening(intro, doc, view)

  // ---- The emblem flies to where the header's own stands.
  const landed = landPatch(mark, tile)
  const name = doc.querySelector('.site-header .brand-logo-name')
  if (seen(name)) landName(word, name, name.getBoundingClientRect())
  else landName(word, null)
  const sub = doc.querySelector('.site-header .brand-sub')
  if (seen(sub)) rise(sub, LANDS_MS, 8, 500)

  // ---- The header: from the landed emblem a stitch runs along its lower edge, and its buttons rise out of that line
  // as the stitch passes under them.
  const header = doc.querySelector('.site-header')
  const bar = doc.querySelector<HTMLElement>('.site-header .container')
  const seams = doc.createElement('div')
  seams.style.cssText = 'position:absolute;inset:0'
  intro.append(seams)
  const seamStart = LANDS_MS - 80
  const seamMs = 520
  if (header && bar) {
    bar.style.overflow = 'clip'
    const y = header.getBoundingClientRect().bottom - 0.5
    const origin = landed.left + landed.width / 2
    const width = doc.documentElement.clientWidth
    const reach = Math.max(origin, width - origin)
    const seam = (to: number) => seamStitch([origin, 3], [to, 3], seamStart, seamMs * Math.abs(to - origin) / reach)
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
    canvas(frames, box.left - room - margin, box.top - room - margin, box.width + (room + margin) * 2, box.height + (room + margin) * 2, [
      frameStitch(box.width + room * 2, box.height + room * 2, 27, margin, 180, 700),
    ])
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

  stitchesGo(seams)
  stitchesGo(frames)

  return run(() => {
    page.remove()
    bar?.style.removeProperty('overflow')
  })
}
