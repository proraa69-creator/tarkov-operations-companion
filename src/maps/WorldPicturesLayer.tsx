import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { DomUtil, Renderer, type Map as LeafletMap, type Point } from 'leaflet'
import type { WorldPoint } from './worldMap'

/**
 * «Все локации»: the region's drawing and every location's picture on ONE canvas (owner, 15.11.2026: «наши карты… лежат поверх
 * этой карты. И вот эта карта под низом… начинает прыгать… при приближении резком, медленном… карта не прыгала. Вообще они
 * должны быть склеены и не двигаться вообще»). As separate image overlays each picture was placed and rounded to whole pixels on
 * its own, and the browser scaled each one apart while zooming; drawn into one canvas they move as one picture — Leaflet scales
 * that canvas during a zoom like its own canvas renderer and draws it anew when the zoom ends.
 */
export interface WorldPicture {
  /** Stable key (an url, or the location and its kind). */
  key: string
  /** An image url, or a picture already drawn. */
  source: string | CanvasImageSource
  rect: [WorldPoint, WorldPoint]
}

interface PictureRenderer {
  addTo(map: LeafletMap): unknown
  remove(): unknown
  _container: HTMLCanvasElement
  _bounds?: { min: Point; max: Point; getSize(): Point }
  _map: (LeafletMap & { _animatingZoom?: boolean }) | null
  pictures: readonly WorldPicture[]
  redraw(): void
}

const images = new Map<string, HTMLImageElement>()

/** The image of an url, loaded once; `onReady` when it was not ready yet. */
function imageOf(url: string, onReady: () => void): HTMLImageElement | null {
  let image = images.get(url)
  if (!image) {
    image = new Image()
    image.decoding = 'async'
    image.src = url
    images.set(url, image)
  }
  if (image.complete && image.naturalWidth) return image
  image.addEventListener('load', onReady, { once: true })
  return null
}

const PictureRendererClass = (Renderer as unknown as { extend(props: object): new (options?: object) => PictureRenderer }).extend({
  _initContainer(this: PictureRenderer) {
    this._container = document.createElement('canvas')
    this._container.className = 'world-map-pictures'
    this.pictures = []
  },
  _destroyContainer(this: PictureRenderer) {
    DomUtil.remove(this._container)
  },
  _update(this: PictureRenderer) {
    if (this._map?._animatingZoom && this._bounds) return
    ;(Renderer.prototype as unknown as { _update: () => void })._update.call(this)
    this.redraw()
  },
  // A flight (flyTo) zooms frame by frame: the canvas is drawn anew at each frame's own zoom, never a picture of the first frame
  // stretched (it showed blank edges flying out and a blur flying in). A wheel or button zoom is Leaflet's short CSS zoom: the
  // whole canvas scales as one there, so nothing in it moves apart, and it is drawn anew when that zoom ends.
  _onZoom(this: PictureRenderer & { _reset(): void; _resetAt?: number }) {
    this._resetAt = performance.now()
    this._reset()
  },
  // Dragged further than the canvas reaches past the view: drawn again (once a frame) instead of a blank edge until the drag ends.
  getEvents(this: PictureRenderer & { _onMove(): void }) {
    const events = (Renderer.prototype as unknown as { getEvents: () => Record<string, unknown> }).getEvents.call(this)
    return { ...events, move: this._onMove }
  },
  _onMove(this: PictureRenderer & { _moveFrame?: number; _resetAt?: number; _update(): void }) {
    // a flight's move comes with its zoom, which drew it already
    if (this._moveFrame || this._map?._animatingZoom || performance.now() - (this._resetAt ?? 0) < 8) return
    this._moveFrame = requestAnimationFrame(() => {
      this._moveFrame = 0
      if (this._map && !this._map._animatingZoom) this._update()
    })
  },
  redraw(this: PictureRenderer) {
    const map = this._map
    const bounds = this._bounds
    if (!map || !bounds) return
    const size = bounds.getSize()
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const canvas = this._container
    DomUtil.setPosition(canvas, bounds.min)
    const [width, height] = [Math.round(size.x * ratio), Math.round(size.y * ratio)]
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`
    }
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, width, height)
    context.imageSmoothingQuality = 'high'
    // world units → layer pixels, not rounded: every picture on the same exact scale and origin
    const scale = 2 ** map.getZoom()
    const origin = map.getPixelOrigin()
    context.setTransform(ratio * scale, 0, 0, ratio * scale, (-bounds.min.x - origin.x) * ratio, (-bounds.min.y - origin.y) * ratio)
    const [viewX1, viewY1] = [(bounds.min.x + origin.x) / scale, (bounds.min.y + origin.y) / scale]
    const [viewX2, viewY2] = [(bounds.max.x + origin.x) / scale, (bounds.max.y + origin.y) / scale]
    const again = () => this.redraw()
    for (const picture of this.pictures) {
      const [[x1, y1], [x2, y2]] = picture.rect
      if (x2 < viewX1 || x1 > viewX2 || y2 < viewY1 || y1 > viewY2) continue
      const source = typeof picture.source === 'string' ? imageOf(picture.source, again) : picture.source
      if (!source) continue
      context.drawImage(source, x1, y1, x2 - x1, y2 - y1)
    }
  },
})

/** The pictures, in order (the first under the others), on one canvas of the map's pane `pane`. */
export function WorldPicturesLayer({ pictures, pane }: { pictures: readonly WorldPicture[]; pane: string }) {
  const map = useMap()
  const layer = useRef<PictureRenderer | null>(null)
  useEffect(() => {
    const renderer = new PictureRendererClass({ pane, padding: 0.2 })
    renderer.addTo(map)
    layer.current = renderer
    return () => { renderer.remove(); layer.current = null }
  }, [map, pane])
  useEffect(() => {
    const renderer = layer.current
    if (!renderer) return
    renderer.pictures = pictures
    renderer.redraw()
  }, [pictures])
  return null
}
