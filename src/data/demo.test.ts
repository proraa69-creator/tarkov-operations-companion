import { describe, expect, it } from 'vitest'
import { demoDataset } from './demo'

describe('demo dataset', () => {
  it('keeps every marker connected to an existing map', () => {
    const mapIds = new Set(demoDataset.maps.map((map) => map.id))
    expect(demoDataset.markers.every((marker) => mapIds.has(marker.mapId))).toBe(true)
  })

  it('keeps quest item relations valid', () => {
    const itemIds = new Set(demoDataset.items.map((item) => item.id))
    const referencedIds = demoDataset.quests.flatMap((quest) => quest.requiredItems ?? [])
    expect(referencedIds.every((id) => itemIds.has(id))).toBe(true)
  })

  it('has a deep Customs slice', () => {
    const markers = demoDataset.markers.filter((marker) => marker.mapId === 'customs')
    expect(markers.map((marker) => marker.type)).toEqual(expect.arrayContaining(['quest', 'extract', 'key', 'boss', 'cache', 'danger', 'landmark']))
    expect(markers.length).toBeGreaterThanOrEqual(12)
  })

  it('includes every current playable map and configured tile floors', () => {
    expect(demoDataset.maps).toHaveLength(13)
    expect(demoDataset.maps.map((map) => map.id)).toEqual(
      expect.arrayContaining(['icebreaker', 'the-lab', 'the-labyrinth', 'terminal']),
    )

    const tileMaps = demoDataset.maps.filter((map) => map.tileUrl)
    expect(tileMaps).toHaveLength(3)
    for (const map of tileMaps) {
      expect(map.bounds).toBeDefined()
      expect(map.transform).toHaveLength(4)
      expect(map.layers?.length).toBeGreaterThan(0)
      expect(map.layers?.every((layer) => Boolean(layer.tileUrl))).toBe(true)
    }
  })
})
