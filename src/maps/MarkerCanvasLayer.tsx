/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { DomUtil, Renderer, type LeafletMouseEvent, type Map as LeafletMap, type Point } from 'leaflet'
import { onSpritesReady, pixelRatio, sprite, type SpriteSpec } from './markerSprites'
import { markCanvasPick } from './canvasPick'

/**
 * Many map points on one canvas (report №104, owner 09.11.2026: «при приближении каждая метка работает отдельно и прыгает
 * отдельно… чтобы они приклеивались к карте и были единым целым, но также нажимались. И также окошки появлялись при
 * наведении»). The canvas is a Leaflet renderer: it moves with the map — hundreds of DOM icons each animated on its own made a zoom
 * while the map glided freeze for seconds.
 *
 * The icons keep their size and their places all through a zoom (owner, 19.11.2026: «чтобы на всех картах маркеры не прыгали при
 * увеличении или при нажатии»): the canvas used to scale as one picture, so every icon grew or shrank and slid off its spot until
 * the zoom ended and it was drawn again. A flight (flyTo, a pinch) is drawn anew at each frame's own zoom; Leaflet's short CSS zoom
 * (wheel, buttons) still moves the canvas as one, and each frame the icons are painted again at the scale it has reached, smaller
 * by as much, so on the screen they stay the size they are.
 * The point under the pointer is handed back (`onHover`) for the page to draw as its usual icon, with its tooltip, click
 * and menu; a tap where no icon stands yet (a phone) picks the point (`onPick`).
 *
 * The layer alone decides what is under the pointer, also while it is over that icon (owner, 11.11.2026: «если рядом два маркера,
 * то всплывающее окно постоянно прыгает, сделай менее чувствительное, и бывает что окно зависает… после того как убран курсор с
 * иконки окно закрывалось сразу же»): the point shown keeps the pointer while it stays within a few pixels of its icon, even where
 * a neighbour overlaps it (`hoverTarget`), and lets go the moment the pointer is off it or off the map.
 */
export interface CanvasPoint { id: string; latlng: readonly [number, number]; spec: SpriteSpec }

const PANE = 'raidMarkerCanvas'
/** A little room around an icon for the pointer. */
const HIT_SLOP = 3
/** The point shown keeps the pointer this many pixels past its icon, so a neighbour does not take it at the edge. */
export const HOVER_STICK = 6

interface Drawn { id: string; x: number; y: number; left: number; top: number; right: number; bottom: number }

const inside = (box: Drawn, x: number, y: number, room = 0) => x >= box.left - room && x <= box.right + room && y >= box.top - room && y <= box.bottom + room

/**
 * What the pointer is over: the point shown while the pointer stays within HOVER_STICK of its icon, else the top-most icon
 * under it, else nothing. `boxes` are every icon's boxes, the shown (hidden from the canvas) one too, lower ones first.
 */
export function hoverTarget(boxes: readonly Drawn[], current: string | null, x: number, y: number): string | null {
  if (current) {
    const own = boxes.find((box) => box.id === current)
    if (own && inside(own, x, y, HOVER_STICK)) return current
  }
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index]!
    if (inside(box, x, y)) return box.id
  }
  return null
}

interface CanvasRenderer {
  addTo(map: LeafletMap): unknown
  remove(): unknown
  _container: HTMLCanvasElement
  _bounds: { min: Point; max: Point; getSize(): Point }
  _map: LeafletMap & { _animatingZoom?: boolean }
  points: readonly CanvasPoint[]
  drawn: Drawn[]
  /** Every icon's box, the hidden ones too (the shown point is a DOM icon then). */
  boxes: Drawn[]
  hidden: ReadonlySet<string>
  _animFrame?: number
  redraw(): void
  paint(iconScale: number): void
  hitAt(layerPoint: Point): string | null
}

/** How much the canvas is scaled right now by Leaflet's CSS zoom (1 when it is not). */
export function cssScale(element: HTMLElement) {
  const transform = getComputedStyle(element).transform
  if (!transform || transform === 'none') return 1
  const scale = new DOMMatrixReadOnly(transform).a
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

const MarkerRenderer = (Renderer as unknown as { extend(props: object): new (options?: object) => CanvasRenderer }).extend({
  _initContainer(this: CanvasRenderer) {
    this._container = document.createElement('canvas')
    this._container.className = 'raid-marker-canvas'
    this.points = []
    this.drawn = []
    this.boxes = []
    this.hidden = new Set()
  },
  _destroyContainer(this: CanvasRenderer) {
    if (this._animFrame) cancelAnimationFrame(this._animFrame)
    DomUtil.remove(this._container)
  },
  // A flight or a pinch zooms frame by frame: drawn at each frame's zoom, not the first frame's picture stretched.
  _onZoom(this: CanvasRenderer & { _reset(): void }) {
    if (!this._map._animatingZoom) this._reset()
  },
  // Leaflet's CSS zoom: the canvas scales as one; the icons are painted again every frame at the inverse of that scale.
  _onAnimZoom(this: CanvasRenderer, event: unknown) {
    ;(Renderer.prototype as unknown as { _onAnimZoom: (event: unknown) => void })._onAnimZoom.call(this, event)
    if (this._animFrame) cancelAnimationFrame(this._animFrame)
    const step = () => {
      this._animFrame = 0
      if (!this._map?._animatingZoom) return
      this.paint(1 / cssScale(this._container))
      this._animFrame = requestAnimationFrame(step)
    }
    this._animFrame = requestAnimationFrame(step)
  },
  _update(this: CanvasRenderer) {
    if (this._map._animatingZoom && this._bounds) return
    ;(Renderer.prototype as unknown as { _update: () => void })._update.call(this)
    this.redraw()
  },
  redraw(this: CanvasRenderer) {
    if (!this._map || !this._bounds) return
    // mid CSS zoom the canvas keeps the place and scale Leaflet animates; only its icons are painted again
    if (this._map._animatingZoom) { this.paint(1 / cssScale(this._container)); return }
    const bounds = this._bounds
    const size = bounds.getSize()
    const ratio = pixelRatio()
    const canvas = this._container
    DomUtil.setPosition(canvas, bounds.min)
    canvas.width = Math.round(size.x * ratio)
    canvas.height = Math.round(size.y * ratio)
    canvas.style.width = `${size.x}px`
    canvas.style.height = `${size.y}px`
    this.paint(1)
  },
  /** The icons drawn at their points, `iconScale` times their size around their anchors. */
  paint(this: CanvasRenderer, iconScale: number) {
    if (!this._map || !this._bounds) return
    const bounds = this._bounds
    const ratio = pixelRatio()
    const canvas = this._container
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.setTransform(ratio, 0, 0, ratio, -bounds.min.x * ratio, -bounds.min.y * ratio)
    // lower points over higher ones, as Leaflet stacks its markers
    const placed = this.points
      .map((point) => ({ point, at: this._map.latLngToLayerPoint(point.latlng as [number, number]) }))
      .sort((a, b) => a.at.y - b.at.y)
    const drawn: Drawn[] = []
    const boxes: Drawn[] = []
    for (const { point, at } of placed) {
      const picture = sprite(point.spec)
      if (!picture) continue
      const left = at.x - picture.anchorX * iconScale, top = at.y - picture.anchorY * iconScale
      const width = picture.width * iconScale, height = picture.height * iconScale
      if (left > bounds.max.x || top > bounds.max.y || left + width < bounds.min.x || top + height < bounds.min.y) continue
      const box = { id: point.id, x: at.x, y: at.y, left: left + picture.hit.x * iconScale - HIT_SLOP, top: top + picture.hit.y * iconScale - HIT_SLOP, right: left + (picture.hit.x + picture.hit.width) * iconScale + HIT_SLOP, bottom: top + (picture.hit.y + picture.hit.height) * iconScale + HIT_SLOP }
      boxes.push(box)
      if (this.hidden.has(point.id)) continue
      context.drawImage(picture.canvas, left, top, width, height)
      drawn.push(box)
    }
    this.drawn = drawn
    this.boxes = boxes
  },
  hitAt(this: CanvasRenderer, layerPoint: Point) {
    for (let index = this.drawn.length - 1; index >= 0; index -= 1) {
      const box = this.drawn[index]!
      if (layerPoint.x >= box.left && layerPoint.x <= box.right && layerPoint.y >= box.top && layerPoint.y <= box.bottom) return box.id
    }
    return null
  },
})


export function MarkerCanvasLayer({ points, hidden, interactive, onHover, onPick }: {
  points: readonly CanvasPoint[]
  /** Points drawn as DOM icons right now (the hovered one): not on the canvas. */
  hidden: ReadonlySet<string>
  interactive: boolean
  onHover: (id: string | null) => void
  onPick: (id: string) => void
}) {
  const map = useMap()
  const layer = useRef<CanvasRenderer | null>(null)
  const handlers = useRef({ onHover, onPick, interactive })
  useEffect(() => { handlers.current = { onHover, onPick, interactive } })

  useEffect(() => {
    if (!map.getPane(PANE)) {
      const pane = map.createPane(PANE)
      pane.style.zIndex = '590'
      pane.style.pointerEvents = 'none'
    }
    const renderer = new MarkerRenderer({ pane: PANE, padding: 0.4 })
    renderer.addTo(map)
    layer.current = renderer
    let hovered: string | null = null
    let frame = 0
    let last: PointerEvent | null = null
    const container = map.getContainer()
    const show = (id: string | null) => {
      container.classList.toggle('is-over-canvas-point', Boolean(id))
      if (id === hovered) return
      hovered = id
      handlers.current.onHover(id)
    }
    // The container's own pointer moves: they arrive over the shown point's DOM icon and its tooltip too, which Leaflet's
    // `mousemove` of the map does not (the icon keeps its events), so the layer always knows when the pointer is off it.
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      last = event
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!last || !handlers.current.interactive || (map as unknown as { _animatingZoom?: boolean })._animatingZoom) { if (!handlers.current.interactive) show(null); return }
        const at = map.mouseEventToLayerPoint(last as unknown as MouseEvent)
        show(hoverTarget(renderer.boxes, hovered, at.x, at.y))
      })
    }
    const preclick = (event: LeafletMouseEvent) => {
      if (!handlers.current.interactive) return
      const id = renderer.hitAt(event.layerPoint)
      if (!id) return
      markCanvasPick(event)
      handlers.current.onPick(id)
    }
    const leave = () => { last = null; show(null) }
    container.addEventListener('pointermove', move)
    container.addEventListener('pointerleave', leave)
    map.on('preclick', preclick)
    // A drag or a zoom moves the icons from under a still pointer: nothing stays shown.
    map.on('movestart zoomstart', leave)
    const stopReady = onSpritesReady(() => renderer.redraw())
    return () => {
      cancelAnimationFrame(frame)
      stopReady()
      container.removeEventListener('pointermove', move)
      container.removeEventListener('pointerleave', leave)
      map.off('preclick', preclick)
      map.off('movestart zoomstart', leave)
      renderer.remove()
      layer.current = null
    }
  }, [map])

  useEffect(() => {
    const renderer = layer.current
    if (!renderer) return
    renderer.points = points
    renderer.hidden = hidden
    renderer.redraw()
  }, [points, hidden])

  return null
}
