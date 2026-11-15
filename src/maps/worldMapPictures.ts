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
      const svg = selectSvgFloor(source, layers, floor, removed.length ? { removed } : {})
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

/** The picture's own alpha, small and blurred: multiplied in, it fades the outline inwards and keeps the inside sharp. */
function fadeMask(picture: CanvasImageSource, width: number, height: number) {
  const scale = MASK_SIDE / Math.max(width, height)
  const small = canvasOf(width * scale, height * scale)
  small.getContext('2d')?.drawImage(picture, 0, 0, small.width, small.height)
  const blurred = canvasOf(small.width, small.height)
  const context = blurred.getContext('2d')
  if (context) {
    context.filter = `blur(${Math.max(2, Math.round(MASK_SIDE * FEATHER))}px)`
    context.drawImage(small, 0, 0)
  }
  return blurred
}

function faded(picture: CanvasImageSource, mask: HTMLCanvasElement, width: number, height: number): Promise<Blob | null> {
  const out = canvasOf(width, height)
  const context = out.getContext('2d')
  if (!context) return Promise.resolve(null)
  context.drawImage(picture, 0, 0, out.width, out.height)
  context.globalCompositeOperation = 'destination-in'
  context.drawImage(mask, 0, 0, out.width, out.height)
  return new Promise((resolve) => out.toBlob(resolve, 'image/webp', 0.88))
}

function useObjectUrl(make: () => Promise<Blob | null>, key: string) {
  const [shown, setShown] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (!key) return
    let alive = true
    let made: string | undefined
    void make().then((blob) => {
      if (!alive || !blob) return
      made = URL.createObjectURL(blob)
      setShown({ key, url: made })
    }).catch((error) => console.error('Unable to draw the world map picture', error))
    return () => {
      alive = false
      if (made) window.setTimeout(() => URL.revokeObjectURL(made!), 1000)
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- `key` stands for `make`
  return shown?.key === key ? shown.url : null
}

/**
 * The scheme's `floor` (as «Карты» draws it), `width` × `height` px, faded at its outline; no `url`, or `width` 0: none.
 */
export function useSchemePicture(url: string | undefined, layers: MapFloorLayer[], floor: string, removed: readonly string[], width: number, height: number) {
  return useObjectUrl(async () => {
    const image = await floorImage(url!, layers, floor, removed)
    const maskKey = `${url}|${floor}|${removed.join(',')}`
    let mask = masks.get(maskKey)
    if (!mask) {
      mask = Promise.resolve(fadeMask(image, width, height))
      masks.set(maskKey, mask)
    }
    return faded(image, await mask, width, height)
  }, url && width > 0 ? `${url}|${floor}|${removed.join(',')}|${Math.round(width)}x${Math.round(height)}` : '')
}

/** A scheme-less location's tiles in one picture (each tile alone would fade on its own), faded at its outline. */
export function useStitchedTiles(tiles: readonly WorldTile[], size: number): { url: string; rect: [WorldPoint, WorldPoint] } | null {
  const x1 = Math.min(...tiles.map((tile) => tile.rect[0][0]))
  const y1 = Math.min(...tiles.map((tile) => tile.rect[0][1]))
  const x2 = Math.max(...tiles.map((tile) => tile.rect[1][0]))
  const y2 = Math.max(...tiles.map((tile) => tile.rect[1][1]))
  const url = useObjectUrl(async () => {
    const step = tiles[0]!.rect[1][0] - tiles[0]!.rect[0][0]
    const canvas = canvasOf(Math.round((x2 - x1) / step) * size, Math.round((y2 - y1) / step) * size)
    const context = canvas.getContext('2d')
    if (!context) return null
    await Promise.all(tiles.map(async (tile) => {
      try {
        const response = await fetch(tile.url)
        if (!response.ok) return
        const bitmap = await createImageBitmap(await response.blob())
        context.drawImage(bitmap, Math.round((tile.rect[0][0] - x1) / step) * size, Math.round((tile.rect[0][1] - y1) / step) * size, size, size)
      } catch { /* a missing tile stays empty */ }
    }))
    return faded(canvas, fadeMask(canvas, canvas.width, canvas.height), canvas.width, canvas.height)
  }, tiles.map((tile) => tile.url).join('|'))
  return url && tiles.length ? { url, rect: [[x1, y1], [x2, y2]] } : null
}
