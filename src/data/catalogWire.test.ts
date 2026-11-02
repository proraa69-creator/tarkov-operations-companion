import { describe, expect, it } from 'vitest'
import type { AppDataset, MapMarker } from '../domain/types'
import { catalogForWire, catalogFromWire } from './catalogWire'

const marker = (id: string, layerId: MapMarker['layerId'], type: MapMarker['type'] = 'landmark'): MapMarker => ({ id, mapId: 'reserve', type, layerId, title: id, description: '', position: [0, 0] })
const dataset = (markers: MapMarker[]) => ({ maps: [], markers, quests: [], items: [], hideout: [], traders: [] }) as AppDataset

describe('the catalog on the wire (owner, 02.11.2026: an older app fell on «Карты» over the «Рубильники» layer)', () => {
  it('sends a newer layer as one every app knows, and the app puts it back', () => {
    const own = dataset([marker('d2', 'switch'), marker('exit', 'extract.pmc', 'extract')])
    const wire = catalogForWire(own)
    expect(wire.markers.map((entry) => [entry.layerId, entry.wireLayer])).toEqual([['landmark', 'switch'], ['extract.pmc', undefined]])
    const back = catalogFromWire(wire)
    expect(back.markers).toEqual(own.markers)
    expect('wireLayer' in back.markers[0]).toBe(false)
  })

  it('leaves a catalog without such markers as it is', () => {
    const plain = dataset([marker('exit', 'extract.pmc', 'extract')])
    expect(catalogForWire(plain)).toBe(plain)
    expect(catalogFromWire(plain)).toBe(plain)
  })
})
