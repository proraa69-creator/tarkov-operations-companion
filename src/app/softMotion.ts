/**
 * Soft motion on the phone (owner, 12.11.2026: «сделай все нажатия, все переходы тактильные, мягкие… отпружинивали… если
 * нажимаешь, вылезает окно, и остальные блоки плавно перемещаются, они резко… если мне не понравится, будь готов вернуть
 * все обратно быстро»). Everything of it hangs on `SOFT_MOTION`: set it to false and the app moves as before.
 * - a press: the button sinks a little and springs back (styles/softMotion.css, `:root[data-motion="soft"]`), and the
 *   Android phone gives a faint tick;
 * - the blocks of a page glide to their new places when something above them opens, grows or goes, and a block that
 *   appears comes in softly instead of popping up.
 */
import '../styles/softMotion.css'

export const SOFT_MOTION = true

/** The blocks that glide: the page's panels and cards and the rows of lists inside them. */
const BLOCKS = '.content .page > *, .content .panel, .content .stat-card, .content .quest-row, .content .raid-needs-grid > *, .content [data-soft-block]'
/** Never inside these: the map moves by itself (Leaflet), and the windows over the page have their own entrance. */
const SKIP = '.map-stage, .map-shell, .leaflet-container, [role="dialog"], .phone-map-panel'
const GLIDE = { duration: 420, easing: 'cubic-bezier(.22, 1.2, .36, 1)' }
const ENTER = { duration: 320, easing: 'cubic-bezier(.22, 1, .36, 1)' }

type Spot = { x: number; y: number; w: number; h: number }

function reduced() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Turns the soft motion on for the phone layout; returns a cleanup. */
export function installSoftMotion(): () => void {
  if (!SOFT_MOTION || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const root = document.documentElement
  root.setAttribute('data-motion', 'soft')

  // The faint tick of a press on Android (the iPhone's web view has no vibration; its press is the spring alone).
  const tick = (event: PointerEvent) => {
    if (root.getAttribute('data-layout') !== 'mobile' || event.pointerType !== 'touch') return
    const target = (event.target as Element | null)?.closest?.('button, .button, a.nav-link, [role="button"], [role="tab"], [role="switch"]')
    if (!target || (target as HTMLButtonElement).disabled) return
    try { navigator.vibrate?.(6) } catch { /* not allowed here */ }
  }
  document.addEventListener('pointerdown', tick, { passive: true, capture: true })

  let spots = new WeakMap<Element, Spot>()
  let page = ''
  let width = window.innerWidth
  let scheduled = false

  // The place in the page by the offsets, which a glide under way (a translate) does not change, so a block caught mid-glide
  // is measured where it really stands.
  const spotOf = (element: Element): Spot => {
    const html = element as HTMLElement
    let x = 0, y = 0
    for (let node: HTMLElement | null = html; node; node = node.offsetParent as HTMLElement | null) { x += node.offsetLeft; y += node.offsetTop }
    return { x, y, w: html.offsetWidth, h: html.offsetHeight }
  }
  const tracked = () => [...document.querySelectorAll(BLOCKS)].filter((element) => !element.closest(SKIP) && (element as HTMLElement).offsetParent !== null)

  /** Remembers where every block stands now, without moving any (a new page, a turned phone). */
  const remember = () => {
    spots = new WeakMap()
    for (const element of tracked()) spots.set(element, spotOf(element))
  }

  const settle = () => {
    scheduled = false
    if (root.getAttribute('data-layout') !== 'mobile' || reduced()) { remember(); return }
    // the map page changes all the time under Leaflet and has no blocks to glide
    if (document.querySelector('.content .map-page')) { page = ''; return }
    // a new page or a turned phone: no glide, the blocks are simply where they are
    if (location.hash + location.pathname !== page || window.innerWidth !== width) {
      page = location.hash + location.pathname
      width = window.innerWidth
      remember()
      return
    }
    const next = new WeakMap<Element, Spot>()
    for (const element of tracked()) {
      const now = spotOf(element)
      next.set(element, now)
      const before = spots.get(element)
      const html = element as HTMLElement
      if (!before) {
        // a block that appears on the same page comes in softly
        if (now.h > 0 && now.h < window.innerHeight * 1.5) html.animate([{ opacity: 0, translate: '0 10px', scale: '.985' }, { opacity: 1, translate: '0 0', scale: '1' }], ENTER)
        continue
      }
      const dx = before.x - now.x, dy = before.y - now.y
      if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || Math.abs(dy) > window.innerHeight * 1.5) continue
      // a block that only grew or shrank at its own place keeps still; one pushed by its neighbour glides
      html.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], GLIDE)
    }
    spots = next
  }

  // DOM changes come before the next paint (a microtask), so the glide starts from the old place with no flash.
  const changed = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(settle)
  }
  const observer = new MutationObserver(changed)
  const content = () => document.querySelector('.content') ?? document.body
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'open', 'aria-expanded', 'hidden'] })
  const sizes = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(changed) : null
  sizes?.observe(content())
  window.addEventListener('resize', changed)
  remember()

  return () => {
    root.removeAttribute('data-motion')
    document.removeEventListener('pointerdown', tick, { capture: true })
    observer.disconnect()
    sizes?.disconnect()
    window.removeEventListener('resize', changed)
  }
}
