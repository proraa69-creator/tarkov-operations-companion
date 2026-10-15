import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import type { Map as LeafletMap } from 'leaflet'

/**
 * Leaflet maps by their container element. Lets features that only see the DOM (the Hand
 * Control test edition) drive a map directly — e.g. a smooth fractional zoom — instead of
 * faking wheel events. Nothing changes for mouse or keyboard use.
 */
export const leafletMaps = new WeakMap<HTMLElement, LeafletMap>()

/** Put inside a MapContainer to register its map. */
export function RegisterLeafletMap() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    leafletMaps.set(container, map)
    return () => { leafletMaps.delete(container) }
  }, [map])
  return null
}
