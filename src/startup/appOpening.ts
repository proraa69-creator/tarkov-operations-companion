import { prefersReducedMotion } from '../shared/motion'
import { beginOpening, frameStitch, LANDS_MS, RISE, seamStitch, seen, type Box } from './opening'
import './appOpening.css'

/**
 * The app's opening, as the site's (owner, 06.11.2026: «сделай такую же анимацию как открытие сайта [...] чтобы загрузка
 * завершена, он уходит туда в шапку»): when the app has loaded, the emblem flies to its own place at the top left, a stitch
 * runs along the top bar and down the menu, and the window puts itself together behind them.
 *
 * Only the PC's window with its menu. The phone has no name to land on and keeps the fade, as does a reload in the same
 * window (the finished logo, no second show), motion turned off, and the account screen, which has no emblem.
 */

const STILL_OR_NONE = (doc: Document) => doc.documentElement.getAttribute('data-startup-intro') !== 'play'

/** Whatever of the window is still in its own entrance stands finished: its places are measured at rest. */
function settle(doc: Document) {
  doc.querySelectorAll('.content, .sidebar, .topbar').forEach((part) => {
    if (typeof part.getAnimations !== 'function') return
    for (const animation of part.getAnimations({ subtree: true })) {
      if (animation.effect?.getComputedTiming().endTime === Infinity) continue
      try { animation.finish() } catch { /* one that cannot end stays as it is */ }
    }
  })
}

/**
 * Under the intro, once the window has its content. A window with a scrollbar keeps its place now: when the scrollbar comes
 * back as the window opens, nothing is laid out again in the first frame of the flight.
 */
export function prepareAppOpening(doc: Document = document) {
  if (STILL_OR_NONE(doc) || !doc.querySelector('.sidebar')) return
  settle(doc)
  const view = doc.defaultView
  if (view && doc.documentElement.scrollHeight > view.innerHeight) doc.documentElement.style.setProperty('scrollbar-gutter', 'stable')
}

/** Where «RAID OS» really stands in the menu: the two words, at the height of their capitals. */
export function brandNameBox(name: Element, doc: Document): Box | undefined {
  const os = name.querySelector('.brand-os')
  const first = name.firstChild
  if (!os || !first) return undefined
  const range = doc.createRange()
  range.setStartBefore(first)
  range.setEndAfter(os)
  if (typeof range.getBoundingClientRect !== 'function') return undefined
  const box = range.getBoundingClientRect()
  if (!box.width || !box.height) return undefined
  const style = doc.defaultView?.getComputedStyle(name)
  const size = Number.parseFloat(style?.fontSize ?? '') || box.height
  const spacing = Number.parseFloat(style?.letterSpacing ?? '') || 0
  const height = size * 0.73
  return { left: box.left, top: box.top + (box.height - height) / 2, width: box.width - spacing, height }
}

const visibleChildren = (element: Element) => [...element.children].filter((child) => seen(child))

/**
 * What of the page comes up on its own, in reading order. A big group is opened into its parts, three levels down at most,
 * so that a row of cards comes up card by card; only what is on screen, and never more than `limit` pieces.
 */
export function pagePieces(content: Element, windowHeight: number, limit = 24) {
  const found: HTMLElement[] = []
  const contentBox = content.getBoundingClientRect()
  const walk = (parent: Element, depth: number) => {
    for (const child of visibleChildren(parent)) {
      const box = child.getBoundingClientRect()
      if (box.top >= windowHeight) continue
      const wide = box.width > contentBox.width * 0.6
      if (depth < 3 && wide && visibleChildren(child).length > 1) walk(child, depth + 1)
      else found.push(child as HTMLElement)
    }
  }
  walk(content, 0)
  const row = (element: Element) => Math.round(element.getBoundingClientRect().top / 40)
  return found
    .sort((a, b) => row(a) - row(b) || a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    .slice(0, limit)
}

/**
 * Called by `endStartupIntro` in the frame the intro opens. Returns when the window is at rest, or nothing when this is not
 * the window to do it in: the intro then fades.
 */
export function openApp(intro: HTMLElement, doc: Document = document): Promise<void> | undefined {
  const view = doc.defaultView
  const root = doc.documentElement
  const sidebar = doc.querySelector('.sidebar')
  const tile = doc.querySelector('.sidebar .brand-mark')
  const mark = intro.querySelector<HTMLElement>('.si-mk')
  const word = intro.querySelector<HTMLElement>('.si-nm')
  const stillOrOff = STILL_OR_NONE(doc) || prefersReducedMotion()
  if (!view || stillOrOff || !sidebar || !seen(tile) || !seen(mark) || !seen(word) || typeof tile.animate !== 'function') {
    root.style.removeProperty('scrollbar-gutter')
    return undefined
  }
  settle(doc)

  const { canvas, landName, landPatch, move, rise, run, stitchesGo } = beginOpening(intro, doc, view)

  // ---- The emblem and the name land on the menu's own.
  landPatch(mark, tile, '9px')
  const name = doc.querySelector<HTMLElement>('.sidebar .brand-name')
  const nameTarget = name ? brandNameBox(name, doc) : undefined
  const sub = name?.querySelector('.brand-sub')
  // The two words only: «помощник в рейдах» rises under them when they have landed.
  landName(word, name, nameTarget)
  if (seen(sub)) move(sub, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { delay: LANDS_MS + 40, duration: 500, easing: RISE })

  // ---- From the corner of the menu and the top bar a stitch runs along each, and what stands there comes up as it passes.
  const seams = doc.createElement('div')
  seams.style.cssText = 'position:absolute;inset:0'
  intro.append(seams)
  const seamStart = LANDS_MS - 80
  const seamMs = 520
  const width = root.clientWidth
  const height = view.innerHeight
  const menuEdge = sidebar.getBoundingClientRect().right - 0.5
  const bar = doc.querySelector('.topbar')
  const barEdge = bar ? bar.getBoundingClientRect().bottom - 0.5 : 0
  if (bar) {
    canvas(seams, menuEdge, barEdge - 3, width - menuEdge, 6, [seamStitch([0, 3], [width - menuEdge, 3], seamStart, seamMs)])
    for (const item of visibleChildren(bar)) {
      const passed = (item.getBoundingClientRect().left - menuEdge) / (width - menuEdge)
      rise(item, seamStart + passed * seamMs * 0.8, 12)
    }
  }
  canvas(seams, menuEdge - 3, 0, 6, height, [seamStitch([3, barEdge], [3, height], seamStart, seamMs * 0.8)])
  sidebar.querySelectorAll('.nav-label, .nav-link, .sidebar-operator').forEach((item) => {
    if (!seen(item)) return
    const top = item.getBoundingClientRect().top
    if (top >= height) return
    rise(item, seamStart + Math.max(0, top - barEdge) / height * seamMs * 0.8, 10, 500)
  })

  // A theme's decorations beside the menu (the season's mask, the helmet) come with it, by opacity alone: they have moves of their own.
  // The helmet stands in the page's body, not in the shell.
  const shell = doc.querySelector('.app-shell')
  for (const decor of [...(shell ? visibleChildren(shell) : []), ...doc.querySelectorAll('body > .gear-helmet')]) {
    if (decor.matches('.sidebar, .topbar, .content') || !seen(decor)) continue
    const box = decor.getBoundingClientRect()
    if (box.width * box.height > width * height * 0.5) continue
    move(decor, [{ opacity: 0 }, { opacity: 1 }], { delay: LANDS_MS, duration: 500, easing: RISE })
  }

  // ---- The page itself. Its pieces stand in a layer of the page, so a visitor who scrolls at once scrolls them too.
  const page = doc.createElement('div')
  page.setAttribute('aria-hidden', 'true')
  page.style.cssText = `position:absolute;left:0;top:0;width:100%;height:${root.scrollHeight}px;overflow:hidden;z-index:30;pointer-events:none`
  doc.body.append(page)
  const content = doc.querySelector('.content .page') ?? doc.querySelector('.content')
  const pieces = content ? pagePieces(content, height) : []
  const step = pieces.length > 1 ? Math.min(46, 620 / (pieces.length - 1)) : 0
  // The largest of them, as the patch: a stitch goes round its place and it comes up inside that.
  const largest = pieces.reduce<HTMLElement | null>((best, piece) => {
    const area = (element: Element) => { const box = element.getBoundingClientRect(); return box.width * box.height }
    return !best || area(piece) > area(best) ? piece : best
  }, null)
  const frames = doc.createElement('div')
  page.append(frames)
  if (largest) {
    const box = largest.getBoundingClientRect()
    if (box.width * box.height > width * height * 0.12) {
      const room = 7
      const margin = 4
      const corner = Number.parseFloat(view.getComputedStyle(largest).borderTopLeftRadius) || 12
      canvas(frames, box.left + view.scrollX - room - margin, box.top + view.scrollY - room - margin, box.width + (room + margin) * 2, box.height + (room + margin) * 2, [
        frameStitch(box.width + room * 2, box.height + room * 2, corner + room, margin, 180, 700),
      ])
    }
  }
  pieces.forEach((piece, i) => rise(piece, piece === largest ? Math.max(440, 300 + i * step) : 300 + i * step, 14, piece === largest ? 700 : 560))

  stitchesGo(seams)
  stitchesGo(frames)

  return run(() => {
    page.remove()
    root.style.removeProperty('scrollbar-gutter')
  })
}
