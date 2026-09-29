/**
 * Runs the Gear theme's hanging kit on one fixed, click-through canvas: dog tags on a ball chain in the
 * sidebar, cord-lock pulls under the pouch-flap snaps of stat cards, carabiners and strap tails under panel
 * flaps. Anchors are read from the live layout, the ropes are simulated at a fixed 60 Hz step and the loop
 * goes to sleep as soon as everything hangs still — it only wakes for the pointer passing close by, for
 * scrolling or for layout changes. The full-window canvas is repainted only when something moved. While the app
 * window is not in use (see src/app/appActivity.ts) nothing runs at all: layout changes are caught up when it is
 * used again. With reduced motion the kit is drawn at rest and never animated.
 */
import { createRope, pushRope, ropeMotion, settleRope, stepRope, tipAngle, type Rope } from './verlet'
import { PIECE_PAD, paintPieces, type Piece, type PieceKind } from './hangerArt'

type RopeStyle = 'ballchain' | 'paracord' | 'webbing'
interface Hanger {
  el: Element
  region: 'sidebar' | 'content'
  piece: PieceKind
  style: RopeStyle
  rope: Rope
  /** Anchor in viewport px, from the element's rect. */
  anchor: (rect: DOMRect) => { x: number; y: number }
  mount?: 'dring' | 'loop'
  ax: number
  ay: number
  visible: boolean
}

const STEP = 1 / 60
const SLEEP_BELOW = 0.02
/** Motion (px per step) that still shows on screen; below it a settled rope is not repainted. */
const REPAINT_ABOVE = 0.001
const POINTER_RADIUS = 26

export class HangerEngine {
  private ctx: CanvasRenderingContext2D
  private hangers: Hanger[] = []
  private pieces: Record<PieceKind, Piece> | null = null
  private scale = 1
  private raf = 0
  private last = 0
  private acc = 0
  private pointer = { x: -1e4, y: -1e4, lx: -1e4, ly: -1e4, moved: false, t: 0 }
  private scanTimer = 0
  private observer: MutationObserver
  private disposed = false
  private tagLines: [string[], string[]]
  /** The window is not in use: no frames, no layout reads. */
  private idle = false
  /** Layout changed while idle: rescan when the window is used again. */
  private stale = false
  /** Something besides the ropes' own motion needs a repaint (new kit, new art, resized canvas). */
  private dirty = true

  constructor(private canvas: HTMLCanvasElement, private reduced: boolean, tagLines: [string[], string[]]) {
    this.ctx = canvas.getContext('2d')!
    this.tagLines = tagLines
    window.addEventListener('pointermove', this.onPointer, { passive: true })
    window.addEventListener('scroll', this.wake, { passive: true, capture: true })
    window.addEventListener('resize', this.onResize, { passive: true })
    this.observer = new MutationObserver(this.onMutations)
    this.observer.observe(document.body, { childList: true, subtree: true })
    this.onResize()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.clearTimeout(this.scanTimer)
    window.removeEventListener('pointermove', this.onPointer)
    window.removeEventListener('scroll', this.wake, { capture: true })
    window.removeEventListener('resize', this.onResize)
    this.observer.disconnect()
  }

  setTagLines(lines: [string[], string[]]) {
    this.tagLines = lines
    this.pieces = paintPieces(this.scale, lines)
    this.dirty = true
    this.wake()
  }

  /** Window in use or not: asleep while not, catching up on layout changes when it is used again. */
  setActive(active: boolean) {
    if (this.disposed || active === !this.idle) return
    this.idle = !active
    if (this.idle) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
      window.clearTimeout(this.scanTimer)
      return
    }
    if (this.stale) { this.stale = false; this.onResize() } else this.wake()
  }

  /** DOM changes inside a Leaflet map (tiles, markers while panning) never move a panel's kit. */
  private onMutations = (records: MutationRecord[]) => {
    if (records.every((record) => (record.target as Element).closest?.('.leaflet-container'))) return
    this.scheduleScan()
  }

  private onResize = () => {
    if (this.idle) { this.stale = true; return }
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(window.innerWidth * dpr)
    this.canvas.height = Math.round(window.innerHeight * dpr)
    // paint the art at 2x the screen scale so rotated blits stay crisp
    const scale = dpr * 2
    if (scale !== this.scale || !this.pieces) { this.scale = scale; this.pieces = paintPieces(scale, this.tagLines) }
    // resizing clears the canvas
    this.dirty = true
    this.scan()
  }

  private scheduleScan = () => {
    if (this.idle) { this.stale = true; return }
    window.clearTimeout(this.scanTimer)
    this.scanTimer = window.setTimeout(() => this.scan(), 180)
  }

  /** Find the blocks that carry kit and keep existing ropes (and their motion) for blocks still present. */
  scan() {
    if (this.disposed) return
    const byEl = new Map<Element, Hanger[]>()
    for (const h of this.hangers) byEl.set(h.el, [...(byEl.get(h.el) ?? []), h])
    const next: Hanger[] = []
    const add = (el: Element, spec: Omit<Hanger, 'el' | 'rope' | 'ax' | 'ay' | 'visible'> & { n: number; seg: number; bend?: number; tipMass?: number; tipRadius?: number }, index = 0) => {
      const existing = byEl.get(el)?.[index]
      if (existing && existing.piece === spec.piece) { next.push(existing); return }
      const a = spec.anchor(el.getBoundingClientRect())
      next.push({
        el, region: spec.region, piece: spec.piece, style: spec.style, anchor: spec.anchor, mount: spec.mount,
        rope: createRope(spec.n, spec.seg, a.x, a.y, { bend: spec.bend, tipMass: spec.tipMass, tipRadius: spec.tipRadius }),
        ax: a.x, ay: a.y, visible: true,
      })
    }
    // Sidebar: two dog tags on ball chains under the last navigation group.
    const sidebar = document.querySelector('.sidebar')
    const groups = document.querySelectorAll('.sidebar .nav-list')
    const lastGroup = groups[groups.length - 1]
    if (sidebar && lastGroup && sidebar.getBoundingClientRect().width > 150) {
      const at = (dx: number) => (rect: DOMRect) => {
        const s = sidebar.getBoundingClientRect()
        return { x: s.right - 58 + dx, y: rect.bottom + 34 }
      }
      add(lastGroup, { region: 'sidebar', piece: 'dogtagSilenced', style: 'ballchain', anchor: at(-2), n: 11, seg: 4.2, tipMass: 4, tipRadius: 12, mount: 'dring' }, 0)
      add(lastGroup, { region: 'sidebar', piece: 'dogtag', style: 'ballchain', anchor: at(2), n: 16, seg: 4.2, tipMass: 4, tipRadius: 12 }, 1)
    }
    // Panels with a flap (header): carabiner on a sewn loop, or a webbing tail, in the right gutter.
    let count = 0
    document.querySelectorAll('.content .panel').forEach((el) => {
      if (count >= 5) return
      const header = el.querySelector(':scope > .panel-header')
      const rect = el.getBoundingClientRect()
      if (!header || rect.height < 170 || rect.width < 260 || el.querySelector('.leaflet-container')) return
      // only every other block gets a small carabiner on a sewn loop; no strap tails
      if (count++ % 2 === 1) return
      const anchor = (r: DOMRect) => { const h = header.getBoundingClientRect(); return { x: r.right - 13, y: h.bottom + 3 } }
      add(el, { region: 'content', piece: 'carabiner', style: 'webbing', anchor, n: 2, seg: 2, tipMass: 2.5, tipRadius: 9, mount: 'loop' })
    })
    if (next.length !== this.hangers.length || next.some((h, index) => h !== this.hangers[index])) this.dirty = true
    this.hangers = next
    this.wake()
  }

  private onPointer = (event: PointerEvent) => {
    if (this.idle) return
    const p = this.pointer
    p.x = event.clientX; p.y = event.clientY
    // wake only when the pointer is near some kit
    for (const h of this.hangers) {
      if (!h.visible) continue
      const len = h.rope.seg * h.rope.n + 44
      if (p.x > h.ax - 60 && p.x < h.ax + 60 && p.y > h.ay - 20 && p.y < h.ay + len) { p.moved = true; this.wake(); return }
    }
    p.lx = p.x; p.ly = p.y
  }

  /** Scrolling or layout: one frame to follow the anchors (the loop keeps going only while something swings). */
  wake = () => {
    if (this.idle) { this.stale = true; return }
    if (this.disposed || this.raf) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  /** Follows the blocks the kit hangs from; true when any anchor moved or appeared / disappeared. */
  private updateAnchors() {
    const vh = window.innerHeight
    let changed = false
    for (const h of this.hangers) {
      if (!h.el.isConnected) { changed ||= h.visible; h.visible = false; continue }
      const a = h.anchor(h.el.getBoundingClientRect())
      // The kit is fastened to its block: when the block scrolls or moves, carry the whole rope with it
      // rigidly, so nothing stretches, flips or tears off while scrolling.
      const dx = a.x - h.ax, dy = a.y - h.ay
      if (dx || dy) {
        const r = h.rope
        for (let i = 0; i < r.n; i++) { r.x[i] += dx; r.y[i] += dy; r.px[i] += dx; r.py[i] += dy }
      }
      h.ax = a.x; h.ay = a.y
      const visible = a.y > -140 && a.y < vh + 10
      if (dx || dy || visible !== h.visible) changed = true
      h.visible = visible
    }
    return changed
  }

  private frame = (now: number) => {
    this.raf = 0
    if (this.disposed) return
    const moved = this.updateAnchors()
    let moving = 0
    if (this.reduced) {
      for (const h of this.hangers) settleRope(h.rope, h.ax, h.ay)
    } else {
      const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000))
      this.last = now
      this.acc = Math.min(this.acc + dt, STEP * 4)
      const p = this.pointer
      if (p.moved) {
        const pdt = Math.max(dt, 1 / 60)
        // sweep the pointer path in small steps so a fast flick still catches the kit
        const vx = (p.x - p.lx) / pdt, vy = (p.y - p.ly) / pdt
        const dist = Math.hypot(p.x - p.lx, p.y - p.ly)
        const samples = p.lx < -1e3 ? 1 : Math.min(12, Math.max(1, Math.ceil(dist / (POINTER_RADIUS * 0.6))))
        for (const h of this.hangers) {
          if (!h.visible) continue
          for (let s = 1; s <= samples; s++) {
            const t = s / samples
            if (pushRope(h.rope, p.lx + (p.x - p.lx) * t, p.ly + (p.y - p.ly) * t, vx, vy, POINTER_RADIUS, STEP)) break
          }
        }
        p.lx = p.x; p.ly = p.y; p.moved = false
      }
      while (this.acc >= STEP) {
        for (const h of this.hangers) if (h.visible) stepRope(h.rope, h.ax, h.ay, STEP)
        this.acc -= STEP
      }
      for (const h of this.hangers) if (h.visible) moving = Math.max(moving, ropeMotion(h.rope))
    }
    // A wake that changed nothing (a scan, a scroll elsewhere) leaves the canvas as it is.
    if (this.dirty || moved || moving > REPAINT_ABOVE) this.draw()
    this.dirty = false
    if (!this.reduced && !this.idle && moving > SLEEP_BELOW) this.raf = requestAnimationFrame(this.frame)
  }

  private draw() {
    const { ctx, canvas } = this
    const dpr = canvas.width / Math.max(1, window.innerWidth)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect()
    for (const region of ['content', 'sidebar'] as const) {
      const list = this.hangers.filter((h) => h.visible && h.region === region)
      if (!list.length) continue
      ctx.save()
      ctx.beginPath()
      if (region === 'content') ctx.rect(sidebar?.right ?? 0, topbar?.bottom ?? 0, window.innerWidth, window.innerHeight)
      else if (sidebar) ctx.rect(sidebar.left, sidebar.top, sidebar.width - 1, sidebar.height)
      ctx.clip()
      for (const h of list) this.drawHanger(h, true)
      for (const h of list) this.drawHanger(h, false)
      ctx.restore()
    }
  }

  private drawHanger(h: Hanger, shadow: boolean) {
    const { ctx } = this
    const r = h.rope
    // light from the top-left: shadows fall down-right onto the panel
    const ox = shadow ? 3.2 : 0, oy = shadow ? 4.5 : 0
    ctx.save()
    ctx.translate(ox, oy)
    if (h.mount) this.drawMount(h, shadow)
    this.drawRope(h, shadow)
    const piece = this.pieces?.[h.piece]
    if (piece) {
      const i = r.n - 1
      const angle = tipAngle(r)
      const squash = Math.cos(r.twist)
      ctx.translate(r.x[i], r.y[i])
      ctx.rotate(-angle)
      ctx.scale(Math.sign(squash) * Math.max(0.18, Math.abs(squash)), 1)
      const img = shadow ? piece.shadow : piece.image
      ctx.drawImage(img, -piece.pivotX - PIECE_PAD, -piece.pivotY - PIECE_PAD, piece.w + PIECE_PAD * 2, piece.h + PIECE_PAD * 2)
    }
    ctx.restore()
  }

  private drawMount(h: Hanger, shadow: boolean) {
    const { ctx } = this
    const x = h.rope.x[0], y = h.rope.y[0]
    if (h.mount === 'loop') {
      // short webbing loop sewn under the flap
      ctx.fillStyle = shadow ? 'rgba(6,7,4,.45)' : '#4a4f3b'
      ctx.beginPath(); ctx.roundRect(x - 6, y - 5, 12, 7, 1.5); ctx.fill()
      if (!shadow) {
        ctx.fillStyle = 'rgba(255,245,215,.18)'; ctx.fillRect(x - 6, y - 5, 12, 1)
        ctx.strokeStyle = 'rgba(210,195,150,.55)'; ctx.lineWidth = 0.6; ctx.setLineDash([1.2, 0.9])
        ctx.beginPath(); ctx.moveTo(x - 4.5, y - 3.5); ctx.lineTo(x + 4.5, y - 3.5); ctx.stroke(); ctx.setLineDash([])
      }
    } else if (h.mount === 'dring') {
      // steel D-ring on a sewn tab
      if (!shadow) {
        ctx.fillStyle = '#2b3024'; ctx.beginPath(); ctx.roundRect(x - 7, y - 14, 18, 10, 2); ctx.fill()
        ctx.strokeStyle = 'rgba(200,190,150,.5)'; ctx.lineWidth = 0.6; ctx.setLineDash([1.3, 1])
        ctx.strokeRect(x - 5.5, y - 12.5, 15, 7); ctx.setLineDash([])
      }
      ctx.lineWidth = 1.6
      ctx.strokeStyle = shadow ? 'rgba(6,7,4,.5)' : '#9aa09c'
      ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 9, y - 5); ctx.quadraticCurveTo(x + 9, y + 3, x + 2, y + 3); ctx.quadraticCurveTo(x - 5, y + 3, x - 5, y - 5); ctx.stroke()
      if (!shadow) { ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.moveTo(x - 4.4, y - 4.4); ctx.quadraticCurveTo(x - 4.4, y + 1.6, x + 1, y + 2.2); ctx.stroke() }
    }
  }

  private drawRope(h: Hanger, shadow: boolean) {
    const { ctx } = this
    const r = h.rope
    const path = () => {
      ctx.beginPath(); ctx.moveTo(r.x[0], r.y[0])
      for (let i = 1; i < r.n - 1; i++) ctx.quadraticCurveTo(r.x[i], r.y[i], (r.x[i] + r.x[i + 1]) / 2, (r.y[i] + r.y[i + 1]) / 2)
      ctx.lineTo(r.x[r.n - 1], r.y[r.n - 1])
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    if (h.style === 'ballchain') {
      if (shadow) { path(); ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(6,7,4,.42)'; ctx.stroke(); return }
      // balls along the path
      let carry = 0
      for (let i = 0; i < r.n - 1; i++) {
        const dx = r.x[i + 1] - r.x[i], dy = r.y[i + 1] - r.y[i], len = Math.hypot(dx, dy)
        for (let d = carry; d < len; d += 2.4) {
          const x = r.x[i] + (dx * d) / len, y = r.y[i] + (dy * d) / len
          ctx.fillStyle = '#5d625f'; ctx.beginPath(); ctx.arc(x, y, 1.05, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = 'rgba(240,244,240,.9)'; ctx.fillRect(x - 0.6, y - 0.6, 0.55, 0.55)
          carry = d + 2.4 - len
        }
      }
      return
    }
    if (h.style === 'paracord') {
      path(); ctx.lineWidth = shadow ? 3 : 2.4; ctx.strokeStyle = shadow ? 'rgba(6,7,4,.4)' : '#4f412c'; ctx.stroke()
      if (shadow) return
      path(); ctx.lineWidth = 1.7; ctx.strokeStyle = '#8b7452'; ctx.stroke()
      path(); ctx.setLineDash([0.9, 1.1]); ctx.lineWidth = 1.7; ctx.strokeStyle = 'rgba(52,40,24,.55)'; ctx.stroke(); ctx.setLineDash([])
      ctx.save(); ctx.translate(-0.45, -0.45); path(); ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(255,238,200,.45)'; ctx.stroke(); ctx.restore()
      return
    }
    // webbing tail: flat strap with dark edges and a centre stitch
    if (r.n < 3) return
    path(); ctx.lineCap = 'butt'
    ctx.lineWidth = shadow ? 9 : 8.5; ctx.strokeStyle = shadow ? 'rgba(6,7,4,.42)' : '#262a1f'; ctx.stroke()
    if (shadow) return
    path(); ctx.lineWidth = 6.8; ctx.strokeStyle = '#4a513d'; ctx.stroke()
    ctx.save(); ctx.translate(-0.9, 0); path(); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,245,215,.16)'; ctx.stroke(); ctx.restore()
    path(); ctx.setLineDash([1.6, 1.2]); ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(214,198,152,.6)'; ctx.stroke(); ctx.setLineDash([])
  }
}
