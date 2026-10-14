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
  '[data-hand-target]',
].join(',')

/**
 * Elements a hand must never activate: text entry (keyboard belongs to the game), native
 * pickers, links that open a browser, the embedded web view, the Leaflet map (MVP) and
 * anything explicitly opted out. All of these would either steal focus or need a keyboard.
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
  '.leaflet-container',
  '[data-hand-control="off"]',
].join(',')

const SNAP_RADIUS = 22
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

function fire(target: Element, type: string, x: number, y: number, pressed: boolean) {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: pressed ? 1 : 0, detail: 1 }
  const event = type.startsWith('pointer') && typeof PointerEvent === 'function'
    ? new PointerEvent(type, { ...init, pointerId: POINTER_ID, pointerType: 'mouse', isPrimary: true })
    : new MouseEvent(type.replace('pointer', 'mouse'), init)
  target.dispatchEvent(event)
}

export class HandUiDispatcher {
  private hovered: Element | null = null
  private pressed: Element | null = null
  private scrollTarget: Element | null = null
  private scrollRemainder = 0

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
      target.scrollBy({ top: Math.round(dy * Math.min(window.innerHeight, target.clientHeight || window.innerHeight)), behavior: 'smooth' })
      return
    }
    const pixels = dy * window.innerHeight + this.scrollRemainder
    const whole = Math.trunc(pixels)
    this.scrollRemainder = pixels - whole
    if (whole) target.scrollBy({ top: whole, behavior: 'instant' })
  }

  scrollEnd() {
    this.scrollTarget?.removeAttribute('data-hand-scrolling')
    this.scrollTarget = null
  }

  /** Stop: drop every highlight and pending action. */
  release() {
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
