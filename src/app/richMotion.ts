/**
 * The app in motion on the PC (owner, 18.11.2026, a reference video of a dashboard: «Ты сможешь сделать нам в приложении такие же
 * анимации?… нужно переработать все приложение»). Everything of it hangs on `RICH_MOTION`: set it to false and the app moves as
 * before. Nothing of a page has to know about it — it reads the page as it is drawn:
 * - a page that opens: its panels rise one after another; inside them the big numbers count up, the bars and progress lines
 *   grow, the lines of charts draw themselves, the rows of lists come one by one;
 * - the highlight of the menu and of the switches (PvP / PvE / Сезон, RU / EN, tabs) glides to the item picked, in the look of
 *   the colour scheme in use;
 * - windows and menus that open come with a little spring; buttons sink when pressed and spring back
 *   (styles/richMotion.css).
 * The phone keeps its own soft motion (src/app/softMotion.ts). Nothing moves with reduced motion, in tests or under the intro.
 */
import '../styles/richMotion.css'
import { canAnimate, EASE_OUT } from '../shared/motion'
import { startupIntroShown } from '../startup/startupIntro'

export const RICH_MOTION = true

/** A page's blocks: the panels and cards, and whatever a page marks itself. */
const BLOCKS = '.panel, .stat-card, [data-motion-block]'
/** Never inside these: the map moves by itself (Leaflet), the windows over the page have their own entrance. */
const SKIP = '.leaflet-container, .map-stage, [role="dialog"], .phone-map-panel, .item-drawer'
/** How long after a change of page the blocks that appear still come in (the page's data arrives a little later). */
const PAGE_WINDOW_MS = 3000
const STAGGER_MS = 55
const MAX_STAGGERED = 10

const SPRING = 'cubic-bezier(.3, 1.25, .4, 1)'

const isDesktop = () => document.documentElement.getAttribute('data-layout') !== 'mobile'
const moving = () => RICH_MOTION && canAnimate() && isDesktop() && !startupIntroShown()

/** The blocks among `nodes` that are not inside another block, top to bottom, left to right. */
function outerBlocks(candidates: Element[]) {
  const set = new Set(candidates)
  return candidates
    .filter((element) => !element.closest(SKIP))
    .filter((element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) if (set.has(parent)) return false
      return true
    })
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => Math.round(a.rect.top / 24) - Math.round(b.rect.top / 24) || a.rect.left - b.rect.left)
}

const inView = (rect: DOMRect) => rect.top < window.innerHeight + 40 && rect.bottom > -40

// ------------------------------------------------------------------------------------------------------------
// A block's entrance and what moves inside it
// ------------------------------------------------------------------------------------------------------------

function enterBlock(element: Element, delay: number) {
  element.animate(
    [{ opacity: 0, translate: '0 16px', scale: '.985' }, { opacity: 1, translate: '0 0', scale: '1' }],
    { duration: 560, delay, easing: EASE_OUT, fill: 'backwards' },
  )
  const inner = delay + 160
  growBars(element, inner)
  drawCharts(element, inner)
  countNumbers(element, inner)
  staggerRows(element, inner)
}

/** Progress lines and bars: a filled part set by its width, inside a bar. */
function growBars(block: Element, delay: number) {
  const fills = block.querySelectorAll<HTMLElement>(':is([class*="bar"], [class*="progress"], [class*="meter"]) > [style*="width"]')
  let index = 0
  for (const fill of fills) {
    if (!/%/.test(fill.style.width) || fill.closest(SKIP)) continue
    fill.animate(
      [{ scale: '0 1', transformOrigin: 'left center' }, { scale: '1 1', transformOrigin: 'left center' }],
      { duration: 820, delay: delay + Math.min(index, 12) * 40, easing: EASE_OUT, fill: 'backwards' },
    )
    index += 1
  }
}

/** Charts drawn in SVG: columns rise from their base, lines draw themselves, rings fill. Icons are left alone. */
function drawCharts(block: Element, delay: number) {
  for (const svg of block.querySelectorAll('svg')) {
    if (svg.closest(SKIP) || svg.classList.contains('lucide')) continue
    const box = svg.getBoundingClientRect()
    if (box.width < 60 || box.height < 40) continue
    const rects = [...svg.querySelectorAll('rect')].filter((rect) => {
      const size = rect.getBBox()
      return size.height > 2 && size.width < box.width * 0.5
    })
    if (rects.length >= 3) {
      rects.forEach((rect, index) => {
        rect.style.transformBox = 'fill-box'
        rect.style.transformOrigin = 'center bottom'
        const animation = rect.animate([{ scale: '1 0' }, { scale: '1 1' }], { duration: 760, delay: delay + Math.min(index, 24) * 28, easing: SPRING, fill: 'backwards' })
        animation.finished.then(() => { rect.style.transformBox = ''; rect.style.transformOrigin = '' }, () => {})
      })
    }
    for (const line of svg.querySelectorAll<SVGGeometryElement>('path, polyline, line, circle')) {
      const style = getComputedStyle(line)
      if (style.stroke === 'none' || style.strokeWidth === '0px') continue
      if (line.tagName !== 'circle' && style.fill !== 'none') continue
      let length: number
      try { length = line.getTotalLength() } catch { continue }
      if (length < 40) continue
      if (style.strokeDasharray !== 'none') {
        // a ring with its share drawn by a dash (a gauge): it fills from nothing to its share
        if (line.tagName !== 'circle' && line.tagName !== 'path') continue
        const offset = parseFloat(style.strokeDashoffset) || 0
        line.animate([{ strokeDashoffset: `${offset + length}` }, { strokeDashoffset: `${offset}` }], { duration: 1000, delay, easing: EASE_OUT, fill: 'backwards' })
        continue
      }
      line.style.strokeDasharray = `${length}`
      const animation = line.animate([{ strokeDashoffset: `${length}` }, { strokeDashoffset: '0' }], { duration: 1000, delay, easing: EASE_OUT, fill: 'backwards' })
      animation.finished.then(() => { line.style.strokeDasharray = '' }, () => { line.style.strokeDasharray = '' })
    }
  }
}

/**
 * A number on its own, written large (a stat, a counter): from 0 to its value. Only the text node's value changes — the node
 * React holds — and a new value from React during the count simply wins.
 */
const NUMBER = /^([^\d-]{0,3})(-?\d{1,3}(?:[\s\u00a0\u202f]\d{3})+|-?\d+)([.,]\d+)?(\s?[^\d]{0,6})$/
function countNumbers(block: Element, delay: number) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  for (let node = walker.nextNode() as Text | null; node && targets.length < 16; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement
    if (!parent || parent.children.length || parent.closest(SKIP) || parent.closest('input, textarea, select, .count-up, time, code')) continue
    const text = node.nodeValue?.trim() ?? ''
    if (!NUMBER.test(text)) continue
    if (parseFloat(getComputedStyle(parent).fontSize) < 17) continue
    targets.push(node)
  }
  for (const node of targets) countUp(node, delay)
}

/** The number in a text and how to write any other value the same way (grouping, decimals, signs around it); null: none. */
export function numberFrames(original: string): { value: number; write: (current: number) => string } | null {
  const trimmed = original.trim()
  const match = NUMBER.exec(trimmed)
  if (!match) return null
  const [, prefix, whole, fraction = '', suffix] = match
  const space = /[\s\u00a0\u202f]/
  const grouped = space.test(whole!)
  const separator = grouped ? (whole!.match(space)?.[0] ?? '\u00a0') : ''
  const decimals = fraction.length ? fraction.length - 1 : 0
  const value = Number(`${whole!.replace(/[\s\u00a0\u202f]/g, '')}.${fraction.slice(1) || '0'}`)
  if (!Number.isFinite(value) || Math.abs(value) < 2) return null
  const lead = original.slice(0, original.indexOf(trimmed))
  const tail = original.slice(original.indexOf(trimmed) + trimmed.length)
  const write = (current: number) => {
    const [int, dec] = current.toFixed(decimals).split('.')
    const intText = grouped ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : int!
    return `${lead}${prefix}${intText}${dec ? `${fraction[0]}${dec}` : ''}${suffix}${tail}`
  }
  return { value, write }
}

function countUp(node: Text, delay: number) {
  const original = node.nodeValue ?? ''
  const frames = numberFrames(original)
  if (!frames) return
  const { value, write } = frames
  const duration = 900
  let last = write(0)
  node.nodeValue = last
  const start = performance.now() + delay
  const tick = (now: number) => {
    // React wrote a new value meanwhile: it stands
    if (node.nodeValue !== last) return
    const progress = Math.min(1, Math.max(0, (now - start) / duration))
    const eased = 1 - Math.pow(1 - progress, 3)
    last = progress >= 1 ? original : write(value * eased)
    node.nodeValue = last
    if (progress < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/** The first rows of a list in the block come one after another. */
function staggerRows(block: Element, delay: number) {
  const lists = block.querySelectorAll(':is(ul, ol, [role="list"], tbody, .list)')
  let total = 0
  for (const list of lists) {
    if (list.closest(SKIP) || list.closest('nav')) continue
    const rows = [...list.children].filter((row) => !(row instanceof HTMLTemplateElement))
    if (rows.length < 3) continue
    // every row in view comes, top to bottom (one left standing below the moving ones looked like a gap); the delay stops
    // growing after a dozen so a long table is in place in about half a second
    let index = 0
    for (const row of rows) {
      if (total >= 60) break
      const rect = row.getBoundingClientRect()
      if (!rect.height) continue
      if (rect.top > window.innerHeight + 40) break
      if (!inView(rect)) continue
      row.animate([{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }], { duration: 420, delay: delay + Math.min(index, 12) * 32, easing: EASE_OUT, fill: 'backwards' })
      index += 1
      total += 1
    }
  }
}

/** A page's blocks in view come in one after another; the ones below the window are simply there. */
function enterBlocks(candidates: Element[]) {
  let index = 0
  for (const { element, rect } of outerBlocks(candidates)) {
    if (!inView(rect)) continue
    enterBlock(element, Math.min(index, MAX_STAGGERED) * STAGGER_MS)
    index += 1
  }
}

// ------------------------------------------------------------------------------------------------------------
// The gliding highlight of the menu and the switches
// ------------------------------------------------------------------------------------------------------------

interface GlideGroup { container: string; item: string; active: string }
const GLIDE_GROUPS: GlideGroup[] = [
  { container: '.sidebar', item: '.nav-link', active: '.nav-link.active' },
  { container: '.mode-switch', item: 'button', active: 'button.active' },
  { container: '.locale-switch', item: 'button', active: 'button.active' },
  { container: '.style-switch', item: 'button', active: 'button.active' },
  { container: '.segmented-filter', item: 'button', active: 'button.active, button[aria-pressed="true"]' },
  { container: '[role="tablist"]', item: '[role="tab"]', active: '[role="tab"][aria-selected="true"]' },
]
const shown = new WeakMap<Element, Element>()

function activeOf(container: Element, group: GlideGroup) {
  return [...container.querySelectorAll(group.active)].find((element) => element.closest(group.container) === container) ?? null
}

/** Remembers every group's active item as it is now (the starting point of the next glide). */
function rememberActive() {
  for (const group of GLIDE_GROUPS) {
    for (const container of document.querySelectorAll(group.container)) {
      const active = activeOf(container, group)
      if (active) shown.set(container, active)
    }
  }
}

function glide(container: HTMLElement, from: Element, to: HTMLElement) {
  const box = container.getBoundingClientRect()
  const start = from.getBoundingClientRect()
  const end = to.getBoundingClientRect()
  if (!start.width || !end.width || (start.top === end.top && start.left === end.left)) return
  const look = getComputedStyle(to)
  if (look.backgroundImage === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(look.backgroundColor)) return
  const place = (rect: DOMRect) => ({
    left: `${rect.left - box.left - container.clientLeft + container.scrollLeft}px`,
    top: `${rect.top - box.top - container.clientTop + container.scrollTop}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  })
  const pill = document.createElement('span')
  pill.className = 'motion-glide'
  pill.setAttribute('aria-hidden', 'true')
  Object.assign(pill.style, {
    backgroundColor: look.backgroundColor,
    backgroundImage: look.backgroundImage,
    borderRadius: look.borderRadius,
    boxShadow: look.boxShadow,
    ...place(end),
  })
  const staticBox = getComputedStyle(container).position === 'static'
  if (staticBox) container.style.position = 'relative'
  container.insertBefore(pill, container.firstChild)
  to.classList.add('motion-glide-target')
  const animation = pill.animate([place(start), place(end)], { duration: 380, easing: SPRING })
  let finished = false
  const done = () => {
    if (finished) return
    finished = true
    pill.remove()
    to.classList.remove('motion-glide-target')
    if (staticBox) container.style.position = ''
  }
  animation.finished.then(done, done)
  // a window that draws no frames (minimized, hidden) never ends an animation: the highlight is the item's own again anyway
  window.setTimeout(done, 600)
}

function glideChanged(records: MutationRecord[]) {
  const touched = new Set<Element>()
  for (const record of records) {
    const target = record.target as Element
    if (record.type !== 'attributes' || !(target instanceof Element)) continue
    for (const group of GLIDE_GROUPS) {
      if (!target.matches(group.item)) continue
      const container = target.closest(group.container)
      if (container) touched.add(container)
    }
  }
  for (const container of touched) {
    const group = GLIDE_GROUPS.find((entry) => container.matches(entry.container))!
    const active = activeOf(container, group)
    const before = shown.get(container)
    if (active) shown.set(container, active)
    if (!active || !before || before === active || !before.isConnected || !moving()) continue
    glide(container as HTMLElement, before, active as HTMLElement)
  }
}

// ------------------------------------------------------------------------------------------------------------
// Windows and menus that open
// ------------------------------------------------------------------------------------------------------------

const POPS = '[role="dialog"], [role="menu"], [role="listbox"], .item-drawer, .popover, .dropdown-menu'
function pop(element: Element) {
  const target = element.matches('[role="dialog"]') && element.firstElementChild && getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)'
    ? element
    : element.matches('[role="dialog"]') ? element.firstElementChild ?? element : element
  if (getComputedStyle(target).animationName !== 'none' || target.getAnimations().length) return
  target.animate([{ opacity: 0, scale: '.96', translate: '0 6px' }, { opacity: 1, scale: '1', translate: '0 0' }], { duration: 300, easing: SPRING })
}

/** The dark layer under a window: it fades in as the window grows. */
const OVERLAYS = '.registration-overlay, .search-overlay, .item-drawer-backdrop, .notice-photo-full'
function fadeIn(element: Element) {
  if (getComputedStyle(element).animationName !== 'none' || element.getAnimations().length) return
  element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' })
}

/**
 * What closes (owner, 19.11.2026: «все окна, которые открываются, всплывающие, раздвигающиеся… плавные»): a window, its dark layer,
 * a menu, a side panel drawn straight under <body> leave at once in React; a still copy of it fades out where it stood. Only what is
 * fixed or absolute on the screen: a copy of anything else would push the page.
 */
const LEAVES = `${OVERLAYS}, [role="dialog"], [role="menu"], [role="listbox"], .theme-scheme-menu, .location-keys`
const GHOST = 'data-motion-ghost'
function fadeOut(node: Element) {
  const ghost = node.cloneNode(true) as HTMLElement
  ghost.setAttribute(GHOST, '')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  document.body.appendChild(ghost)
  const position = getComputedStyle(ghost).position
  if (position !== 'fixed' && position !== 'absolute') { ghost.remove(); return }
  let removed = false
  const done = () => { if (!removed) { removed = true; ghost.remove() } }
  const inner = ghost.matches(OVERLAYS) ? ghost.querySelector('[role="dialog"], .item-drawer, .registration-dialog') : null
  inner?.animate([{ scale: '1', translate: '0 0' }, { scale: '.97', translate: '0 8px' }], { duration: 200, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' })
  const fade = ghost.animate(
    inner ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '.97' }],
    { duration: 200, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' },
  )
  fade.finished.then(done, done)
  // a window that draws no frames never ends an animation
  window.setTimeout(done, 450)
}

// ------------------------------------------------------------------------------------------------------------

/** Turns the motion on; returns a cleanup. */
export function installRichMotion(): () => void {
  if (!RICH_MOTION || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const root = document.documentElement
  root.setAttribute('data-rich-motion', '')

  // The router moves by pushState (no hashchange): a new page is seen by its address when its blocks are added.
  const pageOf = () => location.hash.split('?')[0]
  let page = pageOf()
  let pageAt = performance.now()

  const observer = new MutationObserver((records) => {
    glideChanged(records)
    if (!moving()) return
    if (pageOf() !== page) { page = pageOf(); pageAt = performance.now() }
    const content = document.querySelector('.content')
    const added = new Set<Element>()
    const opened = new Set<Element>()
    for (const record of records) {
      if (record.target === document.body) {
        for (const node of record.removedNodes) {
          if (node instanceof Element && !node.hasAttribute(GHOST) && node.matches(LEAVES)) fadeOut(node)
        }
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element) || node.hasAttribute(GHOST)) continue
        if (node.matches(OVERLAYS)) fadeIn(node)
        if (node.matches(POPS)) opened.add(node)
        else node.querySelectorAll(POPS).forEach((element) => opened.add(element))
        if (content?.contains(node)) {
          if (node.matches(BLOCKS)) added.add(node)
          node.querySelectorAll(BLOCKS).forEach((element) => added.add(element))
        }
      }
    }
    opened.forEach(pop)
    if (!added.size || !content) return
    // the page's blocks come in while the page opens, or when they are the first of the page (the data has arrived)
    const firstOfPage = added.size >= content.querySelectorAll(BLOCKS).length
    if (performance.now() - pageAt < PAGE_WINDOW_MS || firstOfPage) enterBlocks([...added])
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-pressed'] })
  requestAnimationFrame(rememberActive)
  // the menu may be drawn after the start: what is lit is read again before each press changes it
  document.addEventListener('pointerdown', rememberActive, { capture: true, passive: true })

  return () => {
    root.removeAttribute('data-rich-motion')
    document.removeEventListener('pointerdown', rememberActive, { capture: true })
    observer.disconnect()
  }
}
