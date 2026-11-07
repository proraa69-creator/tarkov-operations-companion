import { useEffect, useRef, type MutableRefObject } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import type { Map as LeafletMap } from 'leaflet'

/**
 * Report №97 (08.11.2026): «что бы когда передвигаешь карту случайно не нажимал на значки на карте… при зажатии мышки и
 * передвижения карты не нажимались значки а нужно на них только кликнуть». A press that starts on a point and drags the map
 * reached the point as a click on the PC (the map then flew to it). `dragged` turns true when the map starts moving under the
 * pointer and false at the next press: a point's click while it is true is the end of a drag, not a click.
 */
function follow(map: LeafletMap, dragged: MutableRefObject<boolean>) {
  const container = map.getContainer()
  const press = () => { dragged.current = false }
  const options = { capture: true, passive: true } as const
  container.addEventListener('pointerdown', press, options)
  container.addEventListener('mousedown', press, options)
  container.addEventListener('touchstart', press, options)
  return () => {
    container.removeEventListener('pointerdown', press, options)
    container.removeEventListener('mousedown', press, options)
    container.removeEventListener('touchstart', press, options)
  }
}

/** Inside a MapContainer: true from the moment the map is dragged until the next press on it. */
export function useMapDragged(): MutableRefObject<boolean> {
  const map = useMap()
  const dragged = useRef(false)
  useMapEvents({ dragstart: () => { dragged.current = true } })
  useEffect(() => follow(map, dragged), [map])
  return dragged
}

/** For a page that renders the map's points itself: fills `draggedRef` from inside the MapContainer. */
export function MapDragGuard({ draggedRef }: { draggedRef: MutableRefObject<boolean> }) {
  const map = useMap()
  useMapEvents({ dragstart: () => { draggedRef.current = true } })
  useEffect(() => follow(map, draggedRef), [map, draggedRef])
  return null
}
