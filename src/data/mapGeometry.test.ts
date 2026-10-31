import { describe, expect, it } from 'vitest'
import { maps as offlineMaps } from './demo'
import { withMapGeometry, withMapsGeometry } from './mapGeometry'
import { demoDataset } from './demo'

describe('map geometry', () => {
  it('gives every offline map the coordinates the player dot needs (Улицы and Эпицентр sat in the corner)', () => {
    for (const map of offlineMaps) expect(withMapGeometry(map).transform, map.id).toHaveLength(4)
    expect(withMapGeometry(offlineMaps.find((map) => map.id === 'streets-of-tarkov')!)).toMatchObject({ transform: [0.38, 0, 0.38, 0], coordinateRotation: 180, bounds: [[323, -295], [-280, 532]] })
  })

  it('keeps a map that has its own transform, and the dataset object when nothing is missing', () => {
    const own = { ...offlineMaps[0], transform: [1, 2, 3, 4] as [number, number, number, number], bounds: [[1, 1], [2, 2]] as [[number, number], [number, number]] }
    expect(withMapGeometry(own)).toBe(own)
    const filled = withMapsGeometry(demoDataset)
    expect(withMapsGeometry(filled)).toBe(filled)
  })
})
