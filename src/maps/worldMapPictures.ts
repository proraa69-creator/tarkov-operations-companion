import { useEffect, useState } from 'react'
import { fetchWithMirror } from '../data/mapMirror'
import { selectSvgFloor } from '../components/FloorSvgOverlay'
import type { MapFloorLayer } from '../domain/types'
import type { WorldPoint, WorldTile } from './worldMap'

/**
 * «Общая карта»: our schemes drawn as pictures for the big drawing, their outline faded into it (owner, 15.11.2026:
 * «сделай плавный переход карт, чтобы не было резких границ, а все, что под нашими картами, убери»). The scheme covers the
 * drawing where it draws; its edge fades over a few percent of its size, so the drawing shows through only at the rim.
 *
 * Owner, 15.11.2026: «карта лагает, сделай, чтобы она не тупила». Each location has a light picture for the whole map and
 * a detailed one made only while it is close up and in sight (WorldMapPage); the SVG text, its decoded floor and the fade
 * mask are kept, so a second picture of the same scheme costs one drawing.
 */
const FEATHER = 0.012
/** The fade mask is blurred small and stretched: the same soft edge for any size of picture, for little work. */
const MASK_SIDE = 512

const sources = new Map<string, Promise<string>>()
const floors = new Map<string, Promise<HTMLImageElement>>()
const masks = new Map<string, Promise<HTMLCanvasElement>>()

function svgSource(url: string) {
  let request = sources.get(url)
  if (!request) {
    request = fetchWithMirror(url, { signal: AbortSignal.timeout(30_000) }).then((response) => {
      if (!response.ok) throw new Error(`Map SVG: HTTP ${response.status}`)
      return response.text()
    })
    request.catch(() => sources.delete(url))
    sources.set(url, request)
  }
  return request
}

function floorImage(url: string, layers: MapFloorLayer[], floor: string, removed: readonly string[]) {
  const key = `${url}|${floor}|${removed.join(',')}`
  let request = floors.get(key)
  if (!request) {
    request = svgSource(url).then(async (source) => {
      // a scheme whose floor groups the data does not name is drawn whole, as «Карты» does (FloorSvgOverlay `base`)
      let svg = source
      try { svg = selectSvgFloor(source, layers, floor, removed.length ? { removed } : {}) } catch { /* the whole scheme */ }
      const image = new Image()
      image.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      await image.decode()
      return image
    })
    request.catch(() => floors.delete(key))
    floors.set(key, request)
  }
  return request
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

/**
 * An SVG filter that turns the black around a render into transparency: the renders («Спутник») are black outside the location,
 * and those black blocks covered the drawing. A filter, not reading the pixels: the tiles come from another site and a canvas with
 * them may be drawn but never read.
 */
const BLACK_TO_CLEAR = 'raidos-world-black-to-clear'
function blackToClearFilter() {
  if (typeof document === 'undefined' || document.getElementById(BLACK_TO_CLEAR)) return
  const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  holder.setAttribute('width', '0')
  holder.setAttribute('height', '0')
  holder.setAttribute('aria-hidden', 'true')
  holder.style.position = 'absolute'
  holder.innerHTML = `<filter id="${BLACK_TO_CLEAR}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  6 6 6 0 -0.18" /></filter>`
  document.body.appendChild(holder)
}

/**
 * The picture's own alpha, small and blurred: multiplied in, it fades the outline inwards and keeps the inside sharp. `dark`: the
 * near-black around a render counts as outside too.
 */
function fadeMask(picture: CanvasImageSource, width: number, height: number, dark = false) {
  const scale = MASK_SIDE / Math.max(width, height)
  const small = canvasOf(width * scale, height * scale)
  const smallContext = small.getContext('2d')
  if (smallContext && dark) {
    blackToClearFilter()
    smallContext.filter = `url(#${BLACK_TO_CLEAR})`
  }
  smallContext?.drawImage(picture, 0, 0, small.width, small.height)
  const blurred = canvasOf(small.width, small.height)
  const context = blurred.getContext('2d')
  if (context) {
    context.filter = `blur(${Math.max(2, Math.round(MASK_SIDE * FEATHER))}px)`
    context.drawImage(small, 0, 0)
  }
  return blurred
}

function faded(picture: CanvasImageSource, mask: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement | null {
  const out = canvasOf(width, height)
  const context = out.getContext('2d')
  if (!context) return null
  context.drawImage(picture, 0, 0, out.width, out.height)
  context.globalCompositeOperation = 'destination-in'
  context.drawImage(mask, 0, 0, out.width, out.height)
  return out
}

/**
 * The pictures made, kept by what they show and their size: a location seen close up again, or a floor picked again, is drawn
 * at once. They stay canvases, drawn as they are on the map's canvas — no encoding to a file and back (owner, 15.11.2026: the
 * map stalled as it came close; making a detailed picture's WebP took a good part of a second of the page's own time).
 */
const made = new Map<string, HTMLCanvasElement>()
const MADE_MAX = 40
function keep(key: string, canvas: HTMLCanvasElement) {
  made.delete(key)
  made.set(key, canvas)
  while (made.size > MADE_MAX) made.delete(made.keys().next().value!)
}

/**
 * The scheme's `floor` (as «Карты» draws it), `width` × `height` px, faded at its outline; no `url`, or `width` 0: none. While a
 * new picture is being made the last one stays (owner, 15.11.2026: «при масштабировании карта прыгает»).
 */
export function useSchemePicture(url: string | undefined, layers: MapFloorLayer[], floor: string, removed: readonly string[], width: number, height: number): HTMLCanvasElement | null {
  const key = url && width > 0 ? `${url}|${floor}|${removed.join(',')}|${Math.round(width)}x${Math.round(height)}` : ''
  const [shown, setShown] = useState<{ key: string; canvas: HTMLCanvasElement } | null>(null)
  useEffect(() => {
    if (!key) return
    if (made.has(key)) return
    let alive = true
    void (async () => {
      const image = await floorImage(url!, layers, floor, removed)
      const maskKey = `${url}|${floor}|${removed.join(',')}`
      let mask = masks.get(maskKey)
      if (!mask) {
        mask = Promise.resolve(fadeMask(image, width, height))
        masks.set(maskKey, mask)
      }
      const picture = faded(image, await mask, width, height)
      if (!picture) return
      keep(key, picture)
      if (alive) setShown({ key, canvas: picture })
    })().catch((error) => console.error('Unable to draw the world map picture', error))
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- `key` stands for the rest
  // the picture of this key once it is made (at once when it was made before), else the last one
  return key ? made.get(key) ?? shown?.canvas ?? null : null
}

/** A tile picture, loaded as a plain image: no CORS needed, it is only drawn, never read back. */
function tileImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

/**
 * A location's render tiles in one picture (each tile alone would fade on its own), faded at its outline: Labs, which have no
 * scheme, and every location on «Спутник» (owner, 15.11.2026: «сделать еще режим спутника для нее»). A canvas, drawn as it is
 * on the map's own canvas (WorldPicturesLayer); the last one stays while the next is made.
 */
export function useStitchedTiles(tiles: readonly WorldTile[], size: number): { canvas: HTMLCanvasElement; rect: [WorldPoint, WorldPoint] } | null {
  const key = tiles.map((tile) => tile.url).join('|')
  const [shown, setShown] = useState<{ key: string; canvas: HTMLCanvasElement; rect: [WorldPoint, WorldPoint] } | null>(null)
  useEffect(() => {
    if (!tiles.length) return
    let alive = true
    const x1 = Math.min(...tiles.map((tile) => tile.rect[0][0]))
    const y1 = Math.min(...tiles.map((tile) => tile.rect[0][1]))
    const x2 = Math.max(...tiles.map((tile) => tile.rect[1][0]))
    const y2 = Math.max(...tiles.map((tile) => tile.rect[1][1]))
    const step = tiles[0]!.rect[1][0] - tiles[0]!.rect[0][0]
    void Promise.all(tiles.map(async (tile) => ({ tile, image: await tileImage(tile.url) }))).then((loaded) => {
      if (!alive) return
      const stitched = canvasOf(Math.round((x2 - x1) / step) * size, Math.round((y2 - y1) / step) * size)
      const context = stitched.getContext('2d')
      if (!context) return
      for (const { tile, image } of loaded) {
        if (image) context.drawImage(image, Math.round((tile.rect[0][0] - x1) / step) * size, Math.round((tile.rect[0][1] - y1) / step) * size, size, size)
      }
      const mask = fadeMask(stitched, stitched.width, stitched.height, true)
      const out = canvasOf(stitched.width, stitched.height)
      const fade = out.getContext('2d')
      if (!fade) return
      fade.drawImage(stitched, 0, 0)
      fade.globalCompositeOperation = 'destination-in'
      fade.drawImage(mask, 0, 0, out.width, out.height)
      setShown({ key, canvas: out, rect: [[x1, y1], [x2, y2]] })
    })
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- `key` stands for `tiles`
  // the same object while it shows the same picture: the map is told of a new picture only when there is one
  return tiles.length && shown ? shown : null
}
