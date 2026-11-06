import { cubicBezier } from '../shared/motion'

/**
 * What the site's opening (website/src/siteOpening.ts) and the app's (src/startup/appOpening.ts) share: the emblem flies to
 * its place at the top left and the rest puts itself together with the intro's own moves (owner, 06.11.2026).
 *
 * What keeps it smooth (owner: «каждое движение, каждая анимация»):
 * - everything that moves is opacity or transform, which the graphics process runs by itself;
 * - the stitches are drawn on small canvases, a little further each frame, so a stitch runs at the screen's own rate
 *   instead of jumping from one picture to the next;
 * - curves that start gently: a piece never covers a large part of its way in the first frames.
 *
 * Nothing here hides a page by a style: the pieces are held by animations that start in the frame the intro opens and are
 * dropped at the end, so a page where this never ran simply has the page. At rest it is exactly what it was.
 */

export const RISE = 'cubic-bezier(.2, .7, .2, 1)'
const TRAVEL = 'cubic-bezier(.5, 0, .12, 1)'

export const FLIGHT_MS = 800
/** The header's own emblem appears under the flying one in its last moment, so there is always one and the change is not seen. */
export const LANDS_MS = FLIGHT_MS - 40
/** From the start of the flight to the page at rest. */
export const OPENING_MS = 1650
/** The window was hidden and the animations never ran: the page is released anyway. */
const CEILING_MS = OPENING_MS + 800

export type Point = [number, number]
export type Path = { at: (length: number) => Point; length: number }
export type Box = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>

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

export const seen = (element: Element | null | undefined): element is HTMLElement => {
  if (!element) return false
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0
}

/** A stitch along an edge of the window, in the logo's own dash. */
export const seamStitch = (from: Point, to: Point, start: number, ms: number): Stitch => ({
  path: straightLine(from, to),
  start,
  ms: Math.max(1, ms),
  on: 6,
  off: 4.5,
  width: 1.3,
  colour: 'rgb(176 184 150 / 55%)',
  tail: 260,
  hotWidth: 2.2,
})

/** A stitch round a box, drawn on a canvas `margin` pixels larger than the path on each side. */
export const frameStitch = (width: number, height: number, radius: number, margin: number, start: number, ms: number): Stitch => ({
  path: roundBox(margin, margin, width, height, radius),
  start,
  ms,
  on: 7,
  off: 5,
  width: 1.4,
  colour: 'rgb(176 184 150 / 60%)',
  tail: 340,
  hotWidth: 2.4,
})

/**
 * The intro's layer takes over from here: the ground under the emblem starts to go in this frame. The caller flies what
 * it has and brings up its pieces, then calls `run`, which resolves when all of it is at rest.
 */
export function beginOpening(intro: HTMLElement, doc: Document, view: Window & typeof globalThis) {
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

  intro.style.animation = 'none'
  intro.style.background = 'none'
  const ground = doc.createElement('div')
  ground.style.cssText = 'position:absolute;inset:0;background:#0d1110'
  intro.prepend(ground)
  move(ground, [{ opacity: 1 }, { opacity: 0 }], { duration: 460, easing: 'ease-out', fill: 'forwards' })

  const fly = (element: HTMLElement, target: Box) => {
    const from = element.getBoundingClientRect()
    const to = `translate(${target.left - from.left}px, ${target.top - from.top}px) scale(${target.width / from.width}, ${target.height / from.height})`
    element.style.transformOrigin = '0 0'
    move(element, [{ transform: 'translate(0, 0) scale(1, 1)' }, { transform: to }], { duration: FLIGHT_MS, easing: TRAVEL, fill: 'forwards' })
  }
  /** The flying one goes as the real one is there. */
  const leave = (element: HTMLElement) => move(element, [{ opacity: 1 }, { opacity: 0 }], { delay: LANDS_MS, duration: 120, fill: 'forwards' })

  /** The patch: flies, the real one takes over under it, and a ring goes out from where it landed. */
  const landPatch = (mark: HTMLElement, tile: HTMLElement, radius = '24%') => {
    const landed = tile.getBoundingClientRect()
    fly(mark, landed)
    hold(tile, LANDS_MS)
    leave(mark)
    const shock = doc.createElement('div')
    shock.style.cssText = `position:absolute;left:${landed.left}px;top:${landed.top}px;width:${landed.width}px;height:${landed.height}px;border:1.5px solid #a9b973;border-radius:${radius};opacity:0`
    intro.append(shock)
    move(shock, [
      { opacity: 0.7, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(1.5)' },
    ], { delay: LANDS_MS, duration: 620, easing: RISE, fill: 'none' })
    return landed
  }
  /** The name: the same, or it just goes when there is no name where it flies. */
  const landName = (word: HTMLElement, name: HTMLElement | null, target?: Box) => {
    if (name && target) {
      fly(word, target)
      hold(name, LANDS_MS)
      leave(word)
    } else {
      move(word, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' })
    }
  }

  /** The stitches were only how it was put together: at rest the page has its own lines. */
  const stitchesGo = (holder: Element) => {
    move(holder, [{ opacity: 1 }, { opacity: 0 }], { delay: OPENING_MS - 380, duration: 380, easing: 'ease-in-out', fill: 'forwards' })
  }

  /** From here the stitches run, on the same clock as everything else, one small step on every frame of the screen. */
  const run = (release: () => void) => {
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
    const done = () => {
      released = true
      moves.forEach((animation) => animation.cancel())
      release()
    }
    const finished = Promise.allSettled(moves.map((animation) => animation.finished))
    const ceiling = new Promise<void>((resolve) => { view.setTimeout(resolve, CEILING_MS) })
    return Promise.race([finished, ceiling]).then(done, done)
  }

  return { move, rise, hold, canvas, landPatch, landName, stitchesGo, run }
}
