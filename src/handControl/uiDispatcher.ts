// Delivers hand input to Raid OS's own DOM. It never moves the OS cursor, never sends
// OS-level input and never focuses the window — the game on the other monitor keeps focus.

export const HAND_INTERACTIVE = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="option"]',
  'summary',
  'input[type="checkbox"]',
  'input[type="radio"]',
  '.toggle',
  '.leaflet-interactive',
  '.leaflet-marker-icon',
  '[data-hand-target]',
].join(',')

/**
 * Elements a hand must never activate: text entry (keyboard belongs to the game), native
 * pickers, links that open a browser, the embedded web view and anything explicitly opted out.
 * All of these would either steal focus or need a keyboard. Map markers stay clickable.
 */
export const HAND_BLOCKED = [
  'input:not([type="checkbox"]):not([type="radio"])',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  'a[target]',
  'a[href^="http:"]',
  'a[href^="https:"]',
  'a[download]',
  'webview',
  '[data-hand-control="off"]',
].join(',')

const SNAP_RADIUS = 22
/** Wheel distance Leaflet turns into ~1 zoom level (it divides by 2×DPR on Windows Chromium). */
const WHEEL_PER_STEP = 92
const STICKY_MARGIN = 10
const POINTER_ID = 41

export interface HoverResult { target: Element | null; rect: DOMRect | null }

export function handTarget(element: Element | null): Element | null {
  const candidate = element?.closest(HAND_INTERACTIVE) ?? null
  if (!candidate) return null
  if (candidate.closest(HAND_BLOCKED)) return null
  if (candidate.matches(':disabled, [aria-disabled="true"]')) return null
  return candidate
}

function distanceToRect(x: number, y: number, rect: DOMRect) {
  const dx = Math.max(rect.left - x, 0, x - rect.right)
  const dy = Math.max(rect.top - y, 0, y - rect.bottom)
  return Math.hypot(dx, dy)
}

function scrollableAncestor(element: Element | null): Element | null {
  for (let node = element; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (node.closest('.leaflet-container, webview, [data-hand-control="off"]')) return null
    const style = getComputedStyle(node)
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node
  }
  return document.scrollingElement
}

/** Flick steps glide over ~this time constant; several quick flicks add up instead of cutting each other short. */
const STEP_EASE_MS = 110
/** Momentum after a swipe decays with this time constant (≈ distance = speed × τ). */
const FLING_TAU_MS = 450
const FLING_MAX = 20
const FLING_STOP_PX_S = 30

const nextFrame = (callback: (now: number) => void) => typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame(callback)
  : setTimeout(() => callback(performance.now()), 16) as unknown as number

function fire(target: Element, type: string, x: number, y: number, pressed: boolean) {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: pressed ? 1 : 0, detail: 1 }
  const event = type.startsWith('pointer') && typeof PointerEvent === 'function'
    ? new PointerEvent(type, { ...init, pointerId: POINTER_ID, pointerType: 'mouse', isPrimary: true })
    : new MouseEvent(type.replace('pointer', 'mouse'), init)
  target.dispatchEvent(event)
}

function mapAt(x: number, y: number) {
  const element = document.elementFromPoint(x, y)
  const map = element?.closest('.leaflet-container')
  return map && !element?.closest('[data-hand-control="off"]') ? { element: element!, map } : null
}

export class HandUiDispatcher {
  private grabbing: Element | null = null
  private hovered: Element | null = null
  private pressed: Element | null = null
  private scrollTarget: Element | null = null
  private scrollRemainder = 0
  /** Own scroll animation: pending flick distance (px) and swipe momentum (px/s). */
  private kinetic = { target: null as Element | null, pending: 0, velocity: 0, remainder: 0, last: Number.NaN, scheduled: false }

  constructor(private readonly beforeActivate: () => void = () => {}) {}

  /** Hit test with a small magnetic radius; keeps the current target while the point stays near it. */
  resolve(x: number, y: number): Element | null {
    if (this.hovered?.isConnected) {
      const rect = this.hovered.getBoundingClientRect()
      if (distanceToRect(x, y, rect) <= STICKY_MARGIN && handTarget(this.hovered)) return this.hovered
    }
    const direct = handTarget(document.elementFromPoint(x, y))
    if (direct) return direct
    let best: Element | null = null
    let bestDistance = Infinity
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      for (const radius of [SNAP_RADIUS / 2, SNAP_RADIUS]) {
        const candidate = handTarget(document.elementFromPoint(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius))
        if (!candidate) continue
        const distance = distanceToRect(x, y, candidate.getBoundingClientRect())
        if (distance < bestDistance) { best = candidate; bestDistance = distance }
      }
    }
    return best
  }

  hover(x: number, y: number): HoverResult {
    const target = this.resolve(x, y)
    if (target !== this.hovered) {
      if (this.hovered) {
        this.hovered.removeAttribute('data-hand-hover')
        fire(this.hovered, 'pointerout', x, y, false)
        fire(this.hovered, 'mouseout', x, y, false)
      }
      this.hovered = target
      if (target) {
        target.setAttribute('data-hand-hover', '')
        fire(target, 'pointerover', x, y, false)
        fire(target, 'mouseover', x, y, false)
      }
    }
    return { target, rect: target?.getBoundingClientRect() ?? null }
  }

  /** Visual press only: nothing is dispatched until the press is confirmed, so a cancel has no side effects. */
  press(x: number, y: number) {
    this.stopKinetic()
    this.clearPressed()
    const target = this.resolve(x, y)
    if (!target) return null
    this.pressed = target
    target.setAttribute('data-hand-pressed', '')
    return target
  }

  click(x: number, y: number) {
    const target = this.pressed
    this.clearPressed()
    if (!target?.isConnected || !handTarget(target)) return null
    this.beforeActivate()
    // Native confirm/alert/prompt are modal OS dialogs that would take focus from the game.
    // During a hand click they are answered "no" — confirmed actions stay mouse-only.
    const { confirm, alert, prompt } = window
    window.confirm = () => false
    window.alert = () => {}
    window.prompt = () => null
    try {
      fire(target, 'pointerdown', x, y, true)
      fire(target, 'mousedown', x, y, true)
      fire(target, 'pointerup', x, y, false)
      fire(target, 'mouseup', x, y, false)
      fire(target, 'click', x, y, false)
    } finally {
      Object.assign(window, { confirm, alert, prompt })
    }
    return target
  }

  cancel() {
    this.clearPressed()
  }

  scrollStart(x: number, y: number) {
    this.scrollTarget = scrollableAncestor(document.elementFromPoint(x, y))
    this.scrollRemainder = 0
    this.scrollTarget?.setAttribute('data-hand-scrolling', '')
    return this.scrollTarget
  }

  /** dy in window heights; positive scrolls content further down the page. Steps are animated. */
  scroll(dy: number, step = false) {
    const target = this.scrollTarget
    if (!target) return
    if (step) {
      this.startKinetic(target)
      this.kinetic.pending += dy * Math.min(window.innerHeight, target.clientHeight || window.innerHeight)
      return
    }
    // Dragging against the coasting content catches it, like a finger on a touch screen.
    if (this.kinetic.velocity && Math.sign(this.kinetic.velocity) !== Math.sign(dy)) this.kinetic.velocity = 0
    const pixels = dy * window.innerHeight + this.scrollRemainder
    const whole = Math.trunc(pixels)
    this.scrollRemainder = pixels - whole
    if (whole) target.scrollBy({ top: whole, behavior: 'instant' })
  }

  /** Momentum after a fast swipe, window heights per second; 0 stops whatever is still coasting. */
  fling(v: number) {
    if (!v) { this.stopKinetic(); return }
    const target = this.scrollTarget ?? this.kinetic.target
    if (!target) return
    this.startKinetic(target)
    // Swipes in a row add up (to a cap); one against the motion brakes it.
    const max = FLING_MAX * window.innerHeight
    this.kinetic.velocity = Math.max(-max, Math.min(max, this.kinetic.velocity + v * window.innerHeight))
  }

  /** One animation step; driven by animation frames (public for tests). */
  tick(now: number) {
    const k = this.kinetic
    k.scheduled = false
    const target = k.target
    if (!target?.isConnected) { this.stopKinetic(); return }
    const dt = Number.isNaN(k.last) ? 16 : Math.min(50, Math.max(0, now - k.last))
    k.last = now
    let move = k.pending * (1 - Math.exp(-dt / STEP_EASE_MS))
    k.pending -= move
    if (Math.abs(k.pending) < 0.5) { move += k.pending; k.pending = 0 }
    move += (k.velocity * dt) / 1000
    k.velocity *= Math.exp(-dt / FLING_TAU_MS)
    if (Math.abs(k.velocity) < FLING_STOP_PX_S) k.velocity = 0
    const pixels = move + k.remainder
    const whole = Math.trunc(pixels)
    k.remainder = pixels - whole
    if (whole) {
      const before = target.scrollTop
      target.scrollBy({ top: whole, behavior: 'instant' })
      // Hit the top or the bottom: nothing left to scroll.
      if (target.scrollTop === before) { this.stopKinetic(); return }
    }
    if (k.pending || k.velocity) this.schedule()
    else this.stopKinetic()
  }

  get coasting() {
    return Boolean(this.kinetic.pending || this.kinetic.velocity)
  }

  private startKinetic(target: Element) {
    if (this.kinetic.target !== target) this.stopKinetic()
    this.kinetic.target = target
    this.schedule()
  }

  private schedule() {
    if (this.kinetic.scheduled) return
    this.kinetic.scheduled = true
    nextFrame((now) => this.tick(now))
  }

  private stopKinetic() {
    // A frame may still be scheduled: tick() then finds no target and stops.
    this.kinetic = { ...this.kinetic, target: null, pending: 0, velocity: 0, remainder: 0, last: Number.NaN }
  }

  scrollEnd() {
    this.scrollTarget?.removeAttribute('data-hand-scrolling')
    this.scrollTarget = null
  }

  /** Pinch zoom over a map: one wheel notch per step at the aim point (Leaflet zooms around it). */
  zoom(x: number, y: number, steps: number) {
    const hit = mapAt(x, y)
    if (!hit) return null
    const factor = /Win/i.test(navigator.platform) ? 2 * (window.devicePixelRatio || 1) : 1
    hit.element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY: -steps * WHEEL_PER_STEP * factor, deltaMode: 0 }))
    return hit.map
  }

  /** Palm grab: press the "mouse button" on a map so moving the hand pans it. */
  grabStart(x: number, y: number) {
    this.stopKinetic()
    this.grabEnd(x, y)
    const hit = mapAt(x, y)
    if (!hit) return null
    this.grabbing = hit.element
    hit.map.setAttribute('data-hand-grabbing', '')
    fire(hit.element, 'mousedown', x, y, true)
    return hit.map
  }

  grabMove(x: number, y: number) {
    if (!this.grabbing) return
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }))
  }

  grabEnd(x?: number, y?: number) {
    if (!this.grabbing) return
    this.grabbing.closest('.leaflet-container')?.removeAttribute('data-hand-grabbing')
    this.grabbing = null
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x ?? 0, clientY: y ?? 0, button: 0, buttons: 0 }))
  }

  /** Stop: drop every highlight and pending action. */
  release() {
    this.stopKinetic()
    this.grabEnd()
    this.clearPressed()
    this.scrollEnd()
    this.hovered?.removeAttribute('data-hand-hover')
    this.hovered = null
  }

  private clearPressed() {
    this.pressed?.removeAttribute('data-hand-pressed')
    this.pressed = null
  }
}
