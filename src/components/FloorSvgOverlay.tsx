import { useEffect, useRef, useState } from 'react'
import { ImageOverlay } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { MapFloorLayer } from '../domain/types'

const sources = new Map<string, Promise<string>>()

/**
 * `terrain: true` (default): the ground level stays visible and only the selected building floor is drawn above it.
 * `terrain: false`: only the selected floor's group is drawn (a floor plan over the satellite render).
 */
export function selectSvgFloor(source: string, layers: MapFloorLayer[], selected: string, options: { terrain?: boolean } = {}) {
  const terrain = options.terrain ?? true
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (doc.querySelector('parsererror')) throw new Error('Invalid map SVG')
  doc.querySelectorAll('script, foreignObject').forEach((node) => node.remove())
  for (const node of doc.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || (/href$/i.test(attr.name) && !attr.value.startsWith('#'))) node.removeAttribute(attr.name)
    }
  }
  const setDisplay = (group: Element, show: boolean) => {
    group.setAttribute('display', show ? 'inline' : 'none')
    ;(group as unknown as SVGElement).style.setProperty('display', show ? 'inline' : 'none', 'important')
  }
  let found = false
  const selectedGroups = new Set<string>()
  for (const layer of layers) {
    if (!layer.svgLayer) continue
    const group = doc.getElementById(layer.svgLayer)
    if (!group) continue
    const show = layer.name === selected || (terrain && layer.id === 'main')
    setDisplay(group, show)
    if (layer.name === selected) { found = true; selectedGroups.add(layer.svgLayer) }
  }
  if (!found) throw new Error('Selected floor is missing from the map SVG')
  if (!terrain) {
    // Groups no layer refers to (e.g. First_Floor kept with the ground level) belong to the terrain too.
    for (const group of doc.documentElement.children) {
      if (group.tagName.toLowerCase() === 'g' && group.id && !selectedGroups.has(group.id)) setDisplay(group, false)
    }
  }
  return new XMLSerializer().serializeToString(doc)
}

/**
 * The map SVG with one floor selected. `base`: this is the digital map itself — the plain SVG is shown until
 * the floor-filtered copy is ready (or when it can't be made), and the previous copy stays up while switching floors.
 */
export function FloorSvgOverlay({ url, layers, selected, bounds, terrain = true, base = false, opacity }: {
  url: string
  layers: MapFloorLayer[]
  selected: string
  bounds: LatLngBoundsExpression
  terrain?: boolean
  base?: boolean
  opacity?: number
}) {
  const [image, setImage] = useState<{ key: string; url: string } | null>(null)
  const key = `${url}|${selected}|${terrain ? 1 : 0}`
  // The shown copy is revoked only once the next one replaces it, so switching floors never blanks the map.
  const shown = useRef<string | undefined>(undefined)
  useEffect(() => () => { if (shown.current) URL.revokeObjectURL(shown.current) }, [])
  useEffect(() => {
    let alive = true
    let request = sources.get(url)
    if (!request) {
      request = fetch(url, { signal: AbortSignal.timeout(30_000) }).then((response) => {
        if (!response.ok) throw new Error(`Map SVG: HTTP ${response.status}`)
        return response.text()
      }).catch((error) => { sources.delete(url); throw error })
      sources.set(url, request)
    }
    void request.then((source) => {
      if (!alive) return
      const blobUrl = URL.createObjectURL(new Blob([selectSvgFloor(source, layers, selected, { terrain })], { type: 'image/svg+xml' }))
      const previous = shown.current
      shown.current = blobUrl
      setImage({ key, url: blobUrl })
      if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 1000)
    }).catch((error) => {
      if (!alive) return
      if (base) setImage({ key, url })
      else console.error('Unable to load map floor', error)
    })
    return () => { alive = false }
  }, [url, layers, selected, terrain, base, key])
  if (base) return <ImageOverlay url={image?.url ?? url} bounds={bounds} opacity={opacity ?? 1} zIndex={1} />
  return image?.key === key ? <ImageOverlay url={image.url} bounds={bounds} opacity={opacity ?? 1} zIndex={5} /> : null
}
