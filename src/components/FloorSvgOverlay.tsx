import { useEffect, useState } from 'react'
import { ImageOverlay } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { MapFloorLayer } from '../domain/types'

const sources = new Map<string, Promise<string>>()
export function selectSvgFloor(source: string, layers: MapFloorLayer[], selected: string) {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (doc.querySelector('parsererror')) throw new Error('Invalid map SVG')
  doc.querySelectorAll('script, foreignObject').forEach((node) => node.remove())
  for (const node of doc.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || (/href$/i.test(attr.name) && !attr.value.startsWith('#'))) node.removeAttribute(attr.name)
    }
  }
  let found = false
  for (const layer of layers) {
    if (!layer.svgLayer) continue
    const group = doc.getElementById(layer.svgLayer)
    if (!group) continue
    // The terrain remains visible. Only the selected building floor is drawn above it.
    const show = layer.name === selected || layer.id === 'main'
    group.setAttribute('display', show ? 'inline' : 'none')
    ;(group as unknown as SVGElement).style.setProperty('display', show ? 'inline' : 'none', 'important')
    if (layer.name === selected) found = true
  }
  if (!found) throw new Error('Selected floor is missing from the map SVG')
  return new XMLSerializer().serializeToString(doc)
}

export function FloorSvgOverlay({ url, layers, selected, bounds }: { url: string; layers: MapFloorLayer[]; selected: string; bounds: LatLngBoundsExpression }) {
  const [image, setImage] = useState<{ selected: string; url: string } | null>(null)
  useEffect(() => {
    let alive = true
    let blobUrl: string | undefined
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
      blobUrl = URL.createObjectURL(new Blob([selectSvgFloor(source, layers, selected)], { type: 'image/svg+xml' }))
      setImage({ selected, url: blobUrl })
    }).catch((error) => console.error('Unable to load map floor', error))
    return () => { alive = false; if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [url, layers, selected])
  return image?.selected === selected ? <ImageOverlay url={image.url} bounds={bounds} zIndex={5} /> : null
}
