import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { DomUtil, Renderer, type LeafletMouseEvent, type Map as LeafletMap, type Point } from 'leaflet'
import { onSpritesReady, pixelRatio, sprite, type SpriteSpec } from './markerSprites'
import { CANVAS_PICK } from './canvasPick'

/**
 * Many map points on one canvas (report №104, owner 09.11.2026: «при приближении каждая метка работает отдельно и прыгает
 * отдельно… чтобы они приклеивались к карте и были единым целым, но также нажимались. И также окошки появлялись при
 * наведении»). The canvas is a Leaflet renderer: it moves with the map, scales as one picture during a zoom and is drawn
 * again once it ends — hundreds of DOM icons each animated on its own made a zoom while the map glided freeze for seconds.
 * The point under the pointer is handed back (`onHover`) for the page to draw as its usual icon, with its tooltip, click
 * and menu; a tap where no icon stands yet (a phone) picks the point (`onPick`).
 */
export interface CanvasPoint { id: string; latlng: readonly [number, number]; spec: SpriteSpec }

const PANE = 'raidMarkerCanvas'
/** A little room around an icon for the pointer. */
const HIT_SLOP = 3

interface Drawn { id: string; x: number; y: number; left: number; top: number; right: number; bottom: number }

interface CanvasRenderer {
  addTo(map: LeafletMap): unknown
  remove(): unknown
  _container: HTMLCanvasElement
  _bounds: { min: Point; max: Point; getSize(): Point }
  _map: LeafletMap & { _animatingZoom?: boolean }
  points: readonly CanvasPoint[]
  drawn: Drawn[]
  hidden: ReadonlySet<string>
  redraw(): void
  hitAt(layerPoint: Point): string | null
}

const MarkerRenderer = (Renderer as unknown as { extend(props: object): new (options?: object) => CanvasRenderer }).extend({
  _initContainer(this: CanvasRenderer) {
    this._container = document.createElement('canvas')
    this._container.className = 'raid-marker-canvas'
    this.points = []
    this.drawn = []
    this.hidden = new Set()
  },
  _destroyContainer(this: CanvasRenderer) {
    DomUtil.remove(this._container)
  },
  _update(this: CanvasRenderer) {
    if (this._map._animatingZoom && this._bounds) return
    ;(Renderer.prototype as unknown as { _update: () => void })._update.call(this)
    this.redraw()
  },
  redraw(this: CanvasRenderer) {
    if (!this._map || !this._bounds) return
    const bounds = this._bounds
    const size = bounds.getSize()
    const ratio = pixelRatio()
    const canvas = this._container
    DomUtil.setPosition(canvas, bounds.min)
    canvas.width = Math.round(size.x * ratio)
    canvas.height = Math.round(size.y * ratio)
    canvas.style.width = `${size.x}px`
    canvas.style.height = `${size.y}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, -bounds.min.x * ratio, -bounds.min.y * ratio)
    // lower points over higher ones, as Leaflet stacks its markers
    const placed = this.points
      .filter((point) => !this.hidden.has(point.id))
      .map((point) => ({ point, at: this._map.latLngToLayerPoint(point.latlng as [number, number]) }))
      .sort((a, b) => a.at.y - b.at.y)
    const drawn: Drawn[] = []
    for (const { point, at } of placed) {
      const picture = sprite(point.spec)
      if (!picture) continue
      const left = at.x - picture.anchorX, top = at.y - picture.anchorY
      if (left > bounds.max.x || top > bounds.max.y || left + picture.width < bounds.min.x || top + picture.height < bounds.min.y) continue
      context.drawImage(picture.canvas, left, top, picture.width, picture.height)
      drawn.push({ id: point.id, x: at.x, y: at.y, left: left + picture.hit.x - HIT_SLOP, top: top + picture.hit.y - HIT_SLOP, right: left + picture.hit.x + picture.hit.width + HIT_SLOP, bottom: top + picture.hit.y + picture.hit.height + HIT_SLOP })
    }
    this.drawn = drawn
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
    const move = (event: LeafletMouseEvent) => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const id = handlers.current.interactive ? renderer.hitAt(event.layerPoint) : null
        map.getContainer().classList.toggle('is-over-canvas-point', Boolean(id))
        if (id !== hovered) { hovered = id; if (id) handlers.current.onHover(id) }
      })
    }
    const preclick = (event: LeafletMouseEvent) => {
      if (!handlers.current.interactive) return
      const id = renderer.hitAt(event.layerPoint)
      if (!id) return
      ;(event.originalEvent as unknown as Record<symbol, boolean>)[CANVAS_PICK] = true
      handlers.current.onPick(id)
    }
    const leave = () => { hovered = null; map.getContainer().classList.remove('is-over-canvas-point') }
    map.on('mousemove', move)
    map.on('preclick', preclick)
    map.on('mouseout', leave)
    const stopReady = onSpritesReady(() => renderer.redraw())
    return () => {
      cancelAnimationFrame(frame)
      stopReady()
      map.off('mousemove', move)
      map.off('preclick', preclick)
      map.off('mouseout', leave)
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
