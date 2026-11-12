// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { adaptLiveMapMarkers, SNIPER_SPOT_TITLE } from './mapMarkerAdapter'
import { catalogForWire, catalogFromWire } from './catalogWire'
import { maps } from './demo'
import { defaultHiddenMarkerLayers, defaultVisibleMarkerLayers } from '../domain/mapLayers'
import type { AppDataset } from '../domain/types'

// Owner, 12.11.2026: «я не увидел маркера точек снайперов на картах» — they were on «Опасности», hidden by default.
describe('Scav sniper spots: a layer of their own, «Снайперы», shown from the start', () => {
  const context = { maps, quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
  const snipers = () => adaptLiveMapMarkers({ maps: { a: { normalizedName: 'customs' } } }, {}, context).filter((marker) => marker.source === 'game-sniper-zones')

  it('every spot of the game files is on «sniper», visible by default', () => {
    const spots = snipers()
    expect(spots.length).toBe(4)
    expect(spots.every((marker) => marker.layerId === 'sniper' && marker.title === SNIPER_SPOT_TITLE)).toBe(true)
    expect(defaultVisibleMarkerLayers).toContain('sniper')
    expect(defaultHiddenMarkerLayers).not.toContain('sniper')
  })

  it('an app before the layer gets them on «Опасности», this app puts them back', () => {
    const dataset = { markers: snipers(), quests: [] } as unknown as AppDataset
    const wire = catalogForWire(dataset)
    expect(wire.markers.every((marker) => marker.layerId === 'hazard' && marker.wireLayer === 'sniper')).toBe(true)
    expect(catalogFromWire(wire).markers.every((marker) => marker.layerId === 'sniper' && !marker.wireLayer)).toBe(true)
  })
})
