/**
 * «Алькантара»: brushing the nap. When the pointer runs across a button (or another interactive suede surface), the
 * fibres along its path are combed over and change shade just there — against the nap they stand up and look darker
 * and richer, with the nap they lie flat and catch the light. The mark then slowly relaxes back.
 *
 * How: one document-level pointermove listener (only while the theme is on and motion is allowed). The element under
 * the pointer gets a small canvas as its last child, stacked under its content and over its own background
 * (z-index -1 in an isolated stacking context). The canvas redraws in requestAnimationFrame only while some trail is
 * still fading; with nothing to fade there is no loop, and the canvas is removed. No per-button code: any element
 * matching SURFACES works.
 *
 * The trail is a soft band (the fingertip) plus a bundle of fine parallel streaks (fibres dragged in the same line);
 * the streak pattern is fixed per stroke so the lines run continuously along the path.
 */
import { useEffect } from 'react'
import '../../styles/theme-alcantara.css'

export const ALCANTARA_THEME_ID = 'alcantara'

/** The nap lies to the left and a little down (the same direction as the fibres in the baked texture). */
const NAP = normalise(-0.94, 0.34)
const SURFACES = [
  '.button', '.nav-link', '.icon-button', '.profile-chip', '.search-trigger', '.catalog-card', '.kappa-cell',
  '.map-priority-tile', '.map-option', '.mode-switch button', '.locale-switch button', '.segmented-filter button', '.alc-stitch-option',
].join(',')
const EXCLUDED = '.leaflet-container, [data-no-nap]'
/** how long a mark takes to relax back, and how long it stays fully visible first (ms) */
const LIFE = 2600
const HOLD = 500
const MAX_POINTS = 240
const STREAKS = 18

interface Point { x: number; y: number; t: number; shade: number; start: boolean }
interface Streak { offset: number; width: number; alpha: number; dash: number[] }
interface Trail {
  el: HTMLElement
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  points: Point[]
  last: { x: number; y: number } | null
  velocity: { x: number; y: number }
  streaks: Streak[]
  radius: number
  restore: { position: string; isolation: string } | null
  width: number
  height: number
  dpr: number
}

function normalise(x: number, y: number) {
  const length = Math.hypot(x, y) || 1
  return { x: x / length, y: y / length }
}

const trails = new Map<HTMLElement, Trail>()
let hovered: HTMLElement | null = null
let frame = 0

function makeStreaks(radius: number): Streak[] {
  return Array.from({ length: STREAKS }, () => {
    // denser towards the middle of the fingertip
    const u = Math.random() * 2 - 1
    // broken lines: single fibres are short, so each streak is dashed with its own irregular rhythm
    const dash = Array.from({ length: 6 }, (_, i) => i % 2 ? 1 + Math.random() * 5 : 3 + Math.random() * 16)
    return { offset: Math.sign(u) * Math.abs(u) ** 1.3 * radius * 0.95, width: 0.45 + Math.random() * 1.1, alpha: 0.35 + Math.random() * 0.65, dash }
  })
}

function attach(el: HTMLElement): Trail | null {
  const canvas = document.createElement('canvas')
  canvas.className = 'alc-nap'
  canvas.setAttribute('aria-hidden', 'true')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const style = getComputedStyle(el)
  let restore: Trail['restore'] = null
  if (style.position === 'static' || style.isolation !== 'isolate') {
    restore = { position: el.style.position, isolation: el.style.isolation }
    if (style.position === 'static') el.style.position = 'relative'
    el.style.isolation = 'isolate'
  }
  const radius = Math.max(4, Math.min(8, el.clientHeight * 0.2))
  const trail: Trail = { el, canvas, ctx, points: [], last: null, velocity: { x: 0, y: 0 }, streaks: makeStreaks(radius), radius, restore, width: 0, height: 0, dpr: 1 }
  const inner = Math.max(0, (parseFloat(style.borderTopLeftRadius) || 0) - (parseFloat(style.borderTopWidth) || 0))
  canvas.style.borderRadius = `${inner}px`
  el.append(canvas)
  fit(trail)
  trails.set(el, trail)
  return trail
}

function detach(trail: Trail) {
  trail.canvas.remove()
  if (trail.restore) {
    trail.el.style.position = trail.restore.position
    trail.el.style.isolation = trail.restore.isolation
  }
  trails.delete(trail.el)
}

function fit(trail: Trail) {
  const width = trail.el.clientWidth, height = trail.el.clientHeight
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  if (width === trail.width && height === trail.height && dpr === trail.dpr) return
  trail.width = width; trail.height = height; trail.dpr = dpr
  trail.canvas.width = Math.max(1, Math.round(width * dpr))
  trail.canvas.height = Math.max(1, Math.round(height * dpr))
  trail.canvas.style.width = `${width}px`
  trail.canvas.style.height = `${height}px`
}

/** 1 → 0 over the mark's life: held, then eased out */
function strength(age: number) {
  if (age <= HOLD) return 1
  const t = Math.min(1, (age - HOLD) / (LIFE - HOLD))
  return 1 - t * t * (3 - 2 * t)
}

function draw(trail: Trail, now: number) {
  const { ctx, points } = trail
  fit(trail)
  ctx.setTransform(trail.dpr, 0, 0, trail.dpr, 0, 0)
  ctx.clearRect(0, 0, trail.width, trail.height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // runs of consecutive segments with the same shade sign and (quantised) strength are drawn as one path each,
  // so the soft band has no beads at the joints
  let run: Point[] = []
  let key = ''
  const flush = () => {
    if (run.length > 1) paintRun(trail, run, Number(key.slice(1)) / 12, key[0] === 'd')
    run = []
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    if (b.start) { flush(); key = ''; continue }
    const level = Math.round(Math.abs(b.shade) * strength(now - b.t) * 12)
    const next = level <= 0 ? '' : `${b.shade < 0 ? 'd' : 'l'}${level}`
    if (next !== key) { flush(); key = next; if (next) run.push(a) }
    if (next) run.push(b)
  }
  flush()
}

function paintRun(trail: Trail, run: Point[], level: number, dark: boolean) {
  const { ctx, radius, streaks } = trail
  // normals averaged over the neighbours, so the offset streaks stay continuous round the bends
  const normals = run.map((_, i) => {
    const a = run[Math.max(0, i - 1)]!, b = run[Math.min(run.length - 1, i + 1)]!
    const d = normalise(b.x - a.x, b.y - a.y)
    return { x: -d.y, y: d.x }
  })
  const colour = dark ? '8, 8, 10' : '226, 230, 236'
  const band = dark ? 0.8 : 0.55
  const streak = dark ? 0.75 : 0.6
  const path = (offset: number) => {
    ctx.beginPath()
    run.forEach((p, i) => {
      const n = normals[i]!
      if (i === 0) ctx.moveTo(p.x + n.x * offset, p.y + n.y * offset)
      else ctx.lineTo(p.x + n.x * offset, p.y + n.y * offset)
    })
  }
  // the fingertip: a soft band built from three widths
  path(0)
  for (const [width, alpha] of [[2.2, 0.35], [1.6, 0.35], [1, 0.4]] as const) {
    ctx.strokeStyle = `rgba(${colour}, ${band * alpha * level})`
    ctx.lineWidth = radius * width
    ctx.stroke()
  }
  // the fibres dragged along it
  for (const s of streaks) {
    path(s.offset)
    ctx.strokeStyle = `rgba(${colour}, ${streak * s.alpha * level})`
    ctx.lineWidth = s.width
    ctx.setLineDash(s.dash)
    ctx.stroke()
  }
  ctx.setLineDash([])
}

function tick(now: number) {
  frame = 0
  for (const trail of [...trails.values()]) {
    if (!trail.el.isConnected) { detach(trail); continue }
    // React may have replaced the element's text (and our canvas with it): put the canvas back
    if (!trail.canvas.isConnected) trail.el.append(trail.canvas)
    while (trail.points.length && now - trail.points[0]!.t > LIFE) trail.points.shift()
    if (trail.points[0]) trail.points[0].start = true
    if (!trail.points.length && trail.el !== hovered) { detach(trail); continue }
    draw(trail, now)
  }
  if ([...trails.values()].some((trail) => trail.points.length)) frame = requestAnimationFrame(tick)
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(tick)
}

function surfaceOf(target: EventTarget | null) {
  if (!(target instanceof Element)) return null
  const el = target.closest<HTMLElement>(SURFACES)
  if (!el || el.closest(EXCLUDED) || el.matches(':disabled')) return null
  return el
}

function onMove(event: PointerEvent) {
  const el = surfaceOf(event.target)
  if (el !== hovered) {
    const previous = hovered && trails.get(hovered)
    if (previous) previous.last = null
    hovered = el
  }
  if (!el) return
  const trail = trails.get(el) ?? attach(el)
  if (!trail) return
  const rect = el.getBoundingClientRect()
  const x = event.clientX - rect.left - el.clientLeft
  const y = event.clientY - rect.top - el.clientTop
  const last = trail.last
  if (last && Math.hypot(x - last.x, y - last.y) < 1.5) return
  const now = performance.now()
  if (!last) {
    trail.points.push({ x, y, t: now, shade: 0, start: true })
    trail.velocity = { x: 0, y: 0 }
  } else {
    // smoothed direction, so a wobbling hand does not flicker between light and dark
    const d = normalise(x - last.x, y - last.y)
    trail.velocity = normalise(trail.velocity.x * 0.55 + d.x * 0.45, trail.velocity.y * 0.55 + d.y * 0.45)
    const along = trail.velocity.x * NAP.x + trail.velocity.y * NAP.y
    const shade = Math.sign(along || -1) * (0.4 + 0.6 * Math.abs(along))
    trail.points.push({ x, y, t: now, shade, start: false })
  }
  trail.last = { x, y }
  if (trail.points.length > MAX_POINTS) trail.points.splice(0, trail.points.length - MAX_POINTS)
  schedule()
}

function onLeaveWindow() {
  const trail = hovered && trails.get(hovered)
  if (trail) trail.last = null
  hovered = null
  schedule()
}

let installed = false
function start() {
  if (installed) return
  installed = true
  document.addEventListener('pointermove', onMove, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeaveWindow)
}
function stop() {
  if (!installed) return
  installed = false
  document.removeEventListener('pointermove', onMove)
  document.documentElement.removeEventListener('pointerleave', onLeaveWindow)
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  hovered = null
  for (const trail of [...trails.values()]) detach(trail)
}

/**
 * Keeps the brushing effect on while «Алькантара» is the theme and the user allows motion; returns the cleanup.
 * Follows theme switches (the data-theme attribute) and the reduced-motion preference live.
 */
export function installNapBrush() {
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const update = () => {
    const on = document.documentElement.dataset.theme === ALCANTARA_THEME_ID && !motion?.matches
    if (on) start(); else stop()
  }
  const observer = new MutationObserver(update)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  motion?.addEventListener?.('change', update)
  update()
  return () => {
    observer.disconnect()
    motion?.removeEventListener?.('change', update)
    stop()
  }
}

/** Mounts the brushing effect for the app window (AppShell). */
export function AlcantaraNap() {
  useEffect(() => installNapBrush(), [])
  return null
}
