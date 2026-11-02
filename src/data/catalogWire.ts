import type { AppDataset, MapMarker, MarkerLayerId } from '../domain/types'

/**
 * The catalog as the server sends it to every app version (owner, 02.11.2026: a player's older app fell on «Карты» with
 * «Cannot read properties of undefined (reading 'size')» — the server of 0.6.0.179 sent the new «Рубильники» layer, an
 * app before it has no icon for that layer, and its map draws every layer it is not told to hide). A layer added after
 * apps are in players' hands travels as one all of them know (hidden by default there), its own name beside it
 * (`wireLayer`); the app puts it back on arrival (src/data/tarkovJsonClient.ts), and the server writes it so
 * (server/src/services/questBase.ts).
 */
const OLDER_LAYER: Partial<Record<MarkerLayerId, MarkerLayerId>> = { switch: 'landmark' }

/** The catalog for the wire: the newer layers' markers under a layer every app knows. The same object when it has none. */
export function catalogForWire(dataset: AppDataset): AppDataset {
  if (!dataset.markers.some((marker) => marker.layerId && OLDER_LAYER[marker.layerId])) return dataset
  return {
    ...dataset,
    markers: dataset.markers.map((marker): MapMarker => {
      const older = marker.layerId ? OLDER_LAYER[marker.layerId] : undefined
      return older ? { ...marker, layerId: older, wireLayer: marker.layerId } : marker
    }),
  }
}

/** The catalog as the app keeps it: every marker on its own layer again. The same object when nothing travelled so. */
export function catalogFromWire(dataset: AppDataset): AppDataset {
  if (!dataset.markers?.some((marker) => marker.wireLayer)) return dataset
  return {
    ...dataset,
    markers: dataset.markers.map((marker): MapMarker => {
      if (!marker.wireLayer) return marker
      const { wireLayer, ...rest } = marker
      return { ...rest, layerId: wireLayer }
    }),
  }
}
