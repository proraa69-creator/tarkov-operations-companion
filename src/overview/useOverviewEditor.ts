import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { EASE_OUT, canAnimate } from '../shared/motion'
import { loadOverviewLayout, saveOverviewLayout } from './overviewLayout'
import {
  addableBlocks, addFree, completeFree, freeFromZones, GRID, groupOf, isCard, loadFreeLayout, moveFree, packFree,
  packedHeight, removeFree, sameFree, saveFreeLayout, SINGLE_BELOW, unitsOf, WIDE, type FreeLayout, type FreePlace,
} from './overviewFreeLayout'
import { baseOverviewLayout, withoutHiddenBlocks } from './overviewDefaults'
import { useOverviewDefaults } from './overviewDefaultsStore'

/** Between blocks, as the Overview always had. */
const GAP = 14
/**
 * The motion of «Стекло» (owner, 20.11.2026: «анимации должны быть все плавные… как видео по стеклянной теме»): the blocks glide on
 * its soft spring (src/app/softMotion.ts GLIDE), settle on the same, a block added comes in as a page's blocks do
 * (src/app/richMotion.ts) and one taken off sinks away as a pressed button does. The lift (a little bigger, a shadow) is the
 * stylesheet's spring (styles/overviewEdit.css).
 */
const GLIDE = { duration: 420, easing: 'cubic-bezier(.22, 1.2, .36, 1)' }
const SETTLE = { duration: 380, easing: 'cubic-bezier(.22, 1.2, .36, 1)' }
const ENTER = { duration: 560, easing: EASE_OUT }
const LEAVE = { duration: 200, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' as const }
/** A press turns into a drag only after this many pixels: a click on the block stays a click. */
const DRAG_THRESHOLD = 4
/** Near the window's top or bottom edge the page scrolls by itself while a block is carried. */
const EDGE = 72
const EDGE_SPEED = 16
const NONE: readonly string[] = []

interface Drag {
  id: string
  pointerId: number
  startX: number
  startY: number
  /** The pointer's place inside the block when it was picked up. */
  grabX: number
  grabY: number
  clientX: number
  clientY: number
  started: boolean
  /** The layout before the drag: Esc puts it back. */
  origin: FreeLayout
  frame: number
  /** What the pointer was captured on. */
  handle: HTMLElement
  /** Takes the window's listeners off. */
  unlisten: () => void
}


const topInset = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar')) || 68

/** The element's running animations (none where the Web Animations API is missing, as in jsdom). */
const animationsOf = (element: Element) => (typeof element.getAnimations === 'function' ? element.getAnimations() : [])

/**
 * «Настроить блоки» on the PC Overview, laid out freely (overviewFreeLayout.ts; owner, 20.11.2026: «все блоки можно перемешать и
 * передвигать как нужно… остальные блоки сдвинутся вниз, которые мешают»). The phone has its own (usePhoneOverview.ts).
 * - Carry a block anywhere: it takes the column under its middle (left or right) and goes above the blocks there whose middle its top
 *   passes; those it would cover slide down. A block has no size of its own: it takes the room where it stands. A card carried onto a row of
 *   cards joins it at the place under the pointer; elsewhere it is a row of its own.
 * - Arrows: up and down past the next block of its columns; left and right a card along its row, a block to the other column.
 * - Esc puts the carried block back, or leaves the editing mode.
 */
export function useOverviewEditor() {
  // «Админ панель» → «Блоки»: the owner's order and hidden blocks for everybody (overviewDefaults.ts), followed live until the
  // player arranges the blocks themselves; hidden blocks stay hidden either way.
  const defaults = useOverviewDefaults()
  const baseZones = useMemo(() => baseOverviewLayout(defaults), [defaults])
  const hidden = defaults?.hidden ?? NONE
  const base = useMemo(() => {
    const zones = freeFromZones(baseZones)
    return completeFree(zones, hidden, zones)
  }, [baseZones, hidden])
  /** The player's own free layout; else their old zones' order (it kept winning over the owner's), else the owner's default. */
  const startOf = useCallback(() => {
    const own = loadFreeLayout(base)
    return completeFree(own ?? freeFromZones(withoutHiddenBlocks(loadOverviewLayout(undefined, baseZones), hidden)), hidden, base)
  }, [base, baseZones, hidden])
  const [layout, setLayout] = useState<FreeLayout>(startOf)
  const [editing, setEditing] = useState(false)
  const [lifted, setLifted] = useState<string | null>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [width, setWidth] = useState(0)
  const [, setTick] = useState(0)
  const elements = useRef(new Map<string, HTMLElement>())
  const container = useRef<HTMLElement | null>(null)
  const layoutRef = useRef(layout)
  /** Where the blocks were on screen just before a move (the «first» of FLIP). */
  const pending = useRef<Map<string, DOMRect> | null>(null)
  const drag = useRef<Drag | null>(null)
  /** Every block's last known height, kept after it is taken off: a block added back is placed by it. */
  const seen = useRef<Record<string, number>>({})
  /** The player moved or took off a block: their layout is kept from then on. */
  const touched = useRef(false)

  const single = width < SINGLE_BELOW
  const heightOf = useCallback((id: string) => heights[id] ?? 0, [heights])
  const places = useMemo(() => packFree(layout, heightOf, GAP, single), [heightOf, layout, single])
  const placesRef = useRef(places)
  const heightRef = useRef(heightOf)
  const unit = (width + GAP) / GRID

  useEffect(() => {
    if (!touched.current) return
    saveFreeLayout(sameFree(layout, base) ? null : layout)
  }, [base, layout])

  // The owner changed the defaults: a player without an own layout gets the new one at once (not in the middle of an edit).
  useEffect(() => {
    if (editing) return
    const next = startOf()
    if (sameFree(next, layoutRef.current)) return
    layoutRef.current = next
    setLayout(next)
  }, [editing, startOf])

  // Sizes: the blocks' heights and the Overview's width, measured after every render; the observer brings a render when content
  // grows or shrinks by itself (a list loaded, a picture come).
  const observer = useRef<ResizeObserver | null>(null)
  const frame = useRef(0)
  const observe = useCallback((element: HTMLElement, on: boolean) => {
    if (typeof ResizeObserver === 'undefined') return
    observer.current ??= new ResizeObserver(() => {
      if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; setTick((value) => value + 1) })
    })
    if (on) observer.current.observe(element)
    else observer.current.unobserve(element)
  }, [])
  useEffect(() => () => { observer.current?.disconnect(); cancelAnimationFrame(frame.current) }, [])
  // After every render on purpose: a block's height follows its content; state is set only when a size really changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    let changed = Object.keys(heights).length !== elements.current.size
    const next: Record<string, number> = {}
    for (const [id, element] of elements.current) {
      // the block's own height: without the row's stretch (minHeight) and without a height given by its corner
      const kept = [element.style.minHeight, element.style.height]
      if (kept[0] || kept[1]) { element.style.minHeight = ''; element.style.height = '' }
      next[id] = element.offsetHeight
      if (kept[0] || kept[1]) { element.style.minHeight = kept[0]!; element.style.height = kept[1]! }
      if (Math.abs((heights[id] ?? -1) - next[id]) > 0.5) changed = true
    }
    Object.assign(seen.current, next)
    if (changed) {
      // a block that grew or shrank: the ones it moves glide (not on the first measure, when nothing stood anywhere yet)
      const known = Object.keys(heights).length > 0 && [...elements.current.keys()].every((id) => id in heights)
      if (known && !pending.current && canAnimate()) {
        const before = new Map<string, DOMRect>()
        for (const [id, element] of elements.current) before.set(id, element.getBoundingClientRect())
        pending.current = before
      }
      setHeights(next)
    }
    const now = container.current?.clientWidth ?? 0
    if (Math.abs(now - width) > 0.5) setWidth(now)
  })

  /** OverviewBlock registers its element from a layout effect (and removes it when it goes). */
  const register = useCallback((id: string, element: HTMLElement | null) => {
    const known = elements.current.get(id)
    if (known && known !== element) observe(known, false)
    if (element) { elements.current.set(id, element); observe(element, true) } else elements.current.delete(id)
  }, [observe])

  const setContainer = useCallback((element: HTMLElement | null) => {
    if (container.current) observe(container.current, false)
    container.current = element
    if (element) observe(element, true)
  }, [observe])

  /** The grid's step (a column with its gap) and its corner in the page. */
  const grid = useCallback(() => {
    const rect = container.current?.getBoundingClientRect()
    return { left: rect?.left ?? 0, top: rect?.top ?? 0, step: ((container.current?.clientWidth ?? 0) + GAP) / GRID }
  }, [])

  /** The carried block under the pointer, wherever its place in the layout is now. */
  const follow = useCallback((d: Drag) => {
    const element = elements.current.get(d.id)
    const place = placesRef.current.find((each) => each.id === d.id)
    if (!element || !place) return
    const { left, top, step } = grid()
    const x = d.clientX - d.grabX - (left + place.x * step)
    const y = d.clientY - d.grabY - (top + place.y)
    element.style.transform = `translate(${x}px, ${y}px)`
  }, [grid])

  const apply = useCallback((next: FreeLayout) => {
    if (next === layoutRef.current) return
    const before = new Map<string, DOMRect>()
    for (const [id, element] of elements.current) before.set(id, element.getBoundingClientRect())
    pending.current = before
    touched.current = true
    layoutRef.current = next
    setLayout(next)
  }, [])

  // FLIP: every block slides from where it was on screen to its new place.
  useLayoutEffect(() => {
    layoutRef.current = layout
    placesRef.current = places
    heightRef.current = heightOf
    const flip = pending.current
    const d = drag.current
    if (d?.started) {
      // Moving an element in the page takes the pointer capture off it: taken again, or the pointer's way out of the window is lost.
      try { if (d.handle.isConnected) d.handle.setPointerCapture?.(d.pointerId) } catch { /* the pointer is gone: its up ends the drag */ }
      follow(d)
    }
    if (!flip) return
    pending.current = null
    if (!canAnimate()) return
    const carried = d?.started ? d.id : null
    for (const [id, element] of elements.current) {
      if (id === carried) continue
      const before = flip.get(id)
      if (!before) {
        // a block added: it comes in where it stands
        element.animate([{ opacity: 0, translate: '0 16px', scale: '.985' }, { opacity: 1, translate: '0 0', scale: '1' }], ENTER)
        continue
      }
      // taken where it is on screen now, mid-glide too, so a new move goes on from there without a jump
      for (const animation of animationsOf(element)) if (animation.id === 'overview-glide') animation.cancel()
      const after = element.getBoundingClientRect()
      const dx = before.left - after.left
      const dy = before.top - after.top
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { ...GLIDE, id: 'overview-glide' })
    }
  }, [follow, heightOf, layout, places])

  /** Where `index` (counted without the block) falls between whole units: never inside a row of cards. */
  const boundary = (order: string[], index: number, group: FreeLayout['group']) => {
    const ends = [0]
    let at = 0
    for (const each of unitsOf({ order, group })) { at += each.ids.length; ends.push(at) }
    return ends.reduce((best, end) => (Math.abs(end - index) < Math.abs(best - index) || (Math.abs(end - index) === Math.abs(best - index) && end > best) ? end : best), 0)
  }

  /**
   * Where the carried block goes. A card over a row of cards joins it at the place under the pointer. Otherwise: its column (the left
   * or the right one, by its middle), and among the
   * blocks of those columns, above each one whose middle its top passes going up, below each one whose middle its bottom passes going
   * down (a tall block is not carried half its height past a short one before they trade places). Other columns keep their places.
   */
  const retarget = useCallback((d: Drag) => {
    const now = layoutRef.current
    const own = placesRef.current.find((place) => place.id === d.id)
    if (!own) return
    const { left: gridLeft, top: gridTop, step } = grid()
    const left = step ? (d.clientX - d.grabX - gridLeft) / step : 0
    const top = d.clientY - d.grabY - gridTop
    const card = isCard(d.id)
    const others = now.order.filter((id) => id !== d.id)
    const without: FreeLayout = { ...now, order: others }
    const rest = packFree(without, heightRef.current, GAP, single)
    const middleX = left + (card ? 3 : own.w / 2)
    const middleY = top + own.h / 2
    if (card) {
      for (const row of unitsOf(without).filter((each) => each.row)) {
        const cards = rest.filter((place) => row.ids.includes(place.id))
        if (!cards.length || cards[0]!.h <= 0) continue
        const from = Math.min(...cards.map((place) => place.x))
        const to = Math.max(...cards.map((place) => place.x + place.w))
        const { y, h } = cards[0]!
        if (middleY < y || middleY > y + h || middleX < from - 1.5 || middleX > to + 1.5) continue
        const before = cards.filter((place) => place.x + place.w / 2 < middleX).length
        const index = before === 0 ? others.indexOf(row.ids[0]!) : others.indexOf(row.ids[before - 1]!) + 1
        apply(moveFree(now, d.id, index, now.x[d.id] ?? 0, groupOf(now, row.ids[0]!)))
        return
      }
    }
    const x = single || !step ? now.x[d.id] ?? 0 : middleX >= WIDE ? WIDE : 0
    const w = single ? GRID : card ? 6 : x >= WIDE ? GRID - WIDE : WIDE
    const current = now.order.indexOf(d.id)
    // the others where they stand now, the carried block among them: measured without it, a tall block put above a short row would
    // pass that row's middle at once and go back under it, over and over
    const placed = placesRef.current
    const near = unitsOf(without).flatMap((each) => {
      const parts = placed.filter((place) => each.ids.includes(place.id))
      if (!parts.length || parts[0]!.h <= 0) return []
      const from = Math.min(...parts.map((place) => place.x))
      const to = Math.max(...parts.map((place) => place.x + place.w))
      return single || (from < x + w && x < to) ? [{ ids: each.ids, y: parts[0]!.y, h: parts[0]!.h }] : []
    })
    const above = near.filter((each) => {
      const middle = each.y + each.h / 2
      return now.order.indexOf(each.ids[0]!) < current ? top >= middle : top + own.h > middle
    })
    const last = above[above.length - 1]
    const wanted = last ? others.indexOf(last.ids[last.ids.length - 1]!) + 1 : near.length ? others.indexOf(near[0]!.ids[0]!) : current
    apply(moveFree(now, d.id, boundary(others, wanted, now.group), x))
  }, [apply, grid, single])

  const autoScroll = useCallback((d: Drag) => {
    const step = () => {
      if (drag.current !== d) return
      const top = topInset()
      let speed = 0
      if (d.clientY < top + EDGE) speed = -EDGE_SPEED * Math.min(1, (top + EDGE - d.clientY) / EDGE)
      else if (d.clientY > window.innerHeight - EDGE) speed = EDGE_SPEED * Math.min(1, (d.clientY - window.innerHeight + EDGE) / EDGE)
      if (speed) {
        const before = window.scrollY
        window.scrollBy(0, speed)
        if (window.scrollY !== before) { follow(d); retarget(d) }
      }
      d.frame = requestAnimationFrame(step)
    }
    d.frame = requestAnimationFrame(step)
  }, [follow, retarget])

  /** Let go: the block settles into its place; `restore` (Esc) first puts the layout back as it was. */
  const finish = useCallback((restore: boolean) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    d.unlisten()
    cancelAnimationFrame(d.frame)
    const element = elements.current.get(d.id)
    if (!d.started || !element) return
    if (restore && !sameFree(d.origin, layoutRef.current)) {
      element.style.transform = ''
      element.style.transformOrigin = ''
      element.style.zIndex = ''
      apply(d.origin)
      setLifted(null)
      return
    }
    const from = element.style.transform
    element.style.transform = ''
    setLifted(null)
    if (!canAnimate()) {
      element.style.transformOrigin = ''
      element.style.zIndex = ''
      return
    }
    const settle = element.animate([{ transform: from }, { transform: 'none' }], { ...SETTLE, id: 'overview-glide' })
    const done = () => { element.style.transformOrigin = ''; element.style.zIndex = '' }
    settle.onfinish = done
    settle.oncancel = done
  }, [apply])

  /** The pointer moved while a block is held. */
  const carry = useCallback((d: Drag, clientX: number, clientY: number) => {
    d.clientX = clientX
    d.clientY = clientY
    if (!d.started) {
      if (Math.hypot(clientX - d.startX, clientY - d.startY) < DRAG_THRESHOLD) return
      d.started = true
      const element = elements.current.get(d.id)
      if (element) {
        element.style.transformOrigin = `${d.grabX}px ${d.grabY}px`
        element.style.zIndex = '30'
      }
      setLifted(d.id)
      autoScroll(d)
    }
    follow(d)
    retarget(d)
  }, [autoScroll, follow, retarget])

  /** Up and down past the next block of its columns; left and right a card along its row, a block to the other column. */
  const nudge = useCallback((id: string, key: string) => {
    const now = layoutRef.current
    const own = placesRef.current.find((place) => place.id === id)
    if (!own) return false
    const others = now.order.filter((other) => other !== id)
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (single) return false
      const row = unitsOf(now).find((each) => each.ids.includes(id))!
      if (row.row && row.ids.length > 1) {
        const at = row.ids.indexOf(id) + (key === 'ArrowLeft' ? -1 : 1)
        if (at < 0 || at >= row.ids.length) return true
        const mates = row.ids.filter((other) => other !== id)
        const index = at === 0 ? others.indexOf(mates[0]!) : others.indexOf(mates[at - 1]!) + 1
        apply(moveFree(now, id, index, now.x[id] ?? 0, groupOf(now, id)))
        return true
      }
      const x = key === 'ArrowLeft' ? 0 : WIDE
      apply(moveFree(now, id, boundary(others, now.order.indexOf(id), now.group), x))
      return true
    }
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return false
    // the blocks of its columns from the top (laid in order where they stand as high)
    const rank = (place: FreePlace) => [place.y, now.order.indexOf(place.id)] as const
    const earlier = (a: FreePlace, b: FreePlace) => rank(a)[0] < rank(b)[0] - 0.5 || (Math.abs(rank(a)[0] - rank(b)[0]) <= 0.5 && rank(a)[1] < rank(b)[1])
    const mates = new Set(unitsOf(now).find((each) => each.ids.includes(id))!.ids)
    const near = placesRef.current.filter((place) => !mates.has(place.id) && (single || (place.x < own.x + own.w && own.x < place.x + place.w)))
    const passed = key === 'ArrowUp'
      ? near.filter((place) => earlier(place, own)).sort((a, b) => (earlier(a, b) ? 1 : -1))[0]
      : near.filter((place) => earlier(own, place)).sort((a, b) => (earlier(a, b) ? -1 : 1))[0]
    if (!passed) return true
    const target = unitsOf({ order: others, group: now.group }).find((each) => each.ids.includes(passed.id))!
    const index = key === 'ArrowUp' ? others.indexOf(target.ids[0]!) : others.indexOf(target.ids[target.ids.length - 1]!) + 1
    apply(moveFree(now, id, index, now.x[id] ?? 0))
    return true
  }, [apply, single])

  const handlers = useCallback((id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || drag.current) return
      const element = elements.current.get(id)
      if (!element) return
      // a glide under way ends where it goes; the jiggle (endless) is left alone: finishing it throws and the drag never began
      for (const animation of animationsOf(element)) {
        if (!Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))) continue
        try { animation.finish() } catch { /* one that cannot finish keeps running */ }
      }
      const rect = element.getBoundingClientRect()
      const handle = event.currentTarget
      handle.setPointerCapture(event.pointerId)
      event.preventDefault()
      const pointerId = event.pointerId
      // On the window, not on the block: a block moved in the page loses the capture (owner, 07.11.2026: «он зависает»).
      const onMove = (moved: globalThis.PointerEvent) => { if (moved.pointerId === pointerId && drag.current?.handle === handle) carry(drag.current, moved.clientX, moved.clientY) }
      const onEnd = (ended: globalThis.PointerEvent) => { if (ended.pointerId === pointerId && drag.current?.handle === handle) finish(false) }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onEnd)
      window.addEventListener('pointercancel', onEnd)
      drag.current = {
        handle,
        unlisten: () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onEnd)
          window.removeEventListener('pointercancel', onEnd)
        },
        id, pointerId,
        startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY,
        grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
        started: false, origin: layoutRef.current, frame: 0,
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (drag.current) return
      if (nudge(id, event.key)) event.preventDefault()
    },
  }), [carry, finish, nudge])

  // Esc: a carried block goes back; otherwise the editing mode ends.
  useEffect(() => {
    if (!editing) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (drag.current) finish(true)
      else setEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, finish])

  // Leaving the editing mode (or the page) drops whatever is being carried.
  useEffect(() => () => finish(false), [editing, finish])

  // The cross: the block sinks away, then the ones of its row to its right move left into its place and those under it come up.
  const remove = useCallback((id: string) => {
    const gone = () => {
      const full = width ? packFree(layoutRef.current, heightRef.current, GAP, false) : []
      apply(removeFree(layoutRef.current, id, full))
    }
    const element = elements.current.get(id)
    if (!element || !canAnimate()) { gone(); return }
    const leave = element.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '.94' }], LEAVE)
    leave.onfinish = gone
    leave.oncancel = gone
  }, [apply, width])

  // «Добавить блок»: a card back into a row of cards with room, a block where it stands highest without moving the others.
  const add = useCallback((id: string) => {
    apply(addFree(layoutRef.current, id, (each) => heightRef.current(each) || seen.current[each] || 0, GAP, base))
  }, [apply, base])

  // «Сбросить»: back to the starting layout (the owner's default for everybody, or the built-in one), removed blocks back too; the old
  // zones' order goes with it.
  const reset = useCallback(() => {
    saveOverviewLayout(baseZones, undefined, baseZones)
    apply(base)
  }, [apply, base, baseZones])

  /**
   * A block's place on the grid (left, top, width; a card as tall as its row's tallest) and its jiggle in «Настроить блоки»: each block
   * its own speed and step, so that they shake out of time with each other (owner, 20.11.2026: «все блоки трясутся в разнобой»), and
   * its own turn, so that the edge of a wide block moves as little as a card's (a few pixels).
   */
  const styleOf = useCallback((id: string): CSSProperties | undefined => {
    const place = places.find((each) => each.id === id)
    if (!place) return undefined
    const own = heights[id] ?? 0
    const pixels = Math.max(0, place.w * unit - GAP)
    const style: CSSProperties & Record<`--${string}`, string> = { left: place.x * unit, top: place.y, width: pixels }
    if (place.h > own + 0.5) style.minHeight = place.h
    const seed = [...id].reduce((hash, letter) => (hash * 31 + letter.charCodeAt(0)) >>> 0, 7)
    const random = (shift: number) => ((seed >>> shift) % 1000) / 1000
    const turn = Math.min(1.6, Math.max(0.35, (2.6 / Math.max(40, pixels / 2)) * (180 / Math.PI)))
    style['--jiggle'] = `${(turn * (0.85 + random(3) * 0.3)).toFixed(3)}deg`
    style['--jiggle-time'] = `${(0.24 + random(7) * 0.1).toFixed(3)}s`
    style['--jiggle-delay'] = `${(-random(11) * 0.4).toFixed(3)}s`
    style['--jiggle-way'] = random(13) < 0.5 ? 'normal' : 'reverse'
    return style
  }, [heights, places, unit])

  return useMemo(() => ({
    layout,
    places,
    height: packedHeight(places),
    single,
    editing,
    lifted,
    isDefault: sameFree(layout, base),
    addable: addableBlocks(layout, hidden),
    add,
    toggleEditing: () => setEditing((value) => !value),
    reset,
    remove,
    register,
    container: setContainer,
    styleOf,
    handlers,
  }), [add, base, editing, handlers, hidden, layout, lifted, places, register, remove, reset, setContainer, single, styleOf])
}

export type OverviewEditor = ReturnType<typeof useOverviewEditor>
