import { describe, expect, it } from 'vitest'
import { adaptMapRenderingConfigs } from './mapConfigClient'

describe('map rendering config adapter', () => {
  it('normalizes Tarkov.dev map rendering config', () => {
    const configs = adaptMapRenderingConfigs([{
      normalizedName: 'customs',
      maps: [{
        key: 'customs',
        minZoom: 1,
        maxZoom: 5,
        transform: [0.239, 168.65, 0.239, 136.35],
        coordinateRotation: 180,
        bounds: [[698, -307], [-372, 237]],
        tilePath: 'https://assets.tarkov.dev/maps/customs/main/{z}/{x}/{y}.png',
        layers: [{ name: '2nd Floor', heightRange: [5, 15] }],
      }],
    }])

    expect(configs.get('customs')).toMatchObject({
      tileUrl: 'https://assets.tarkov.dev/maps/customs/main/{z}/{x}/{y}.png',
      bounds: [[698, -307], [-372, 237]],
      transform: [0.239, 168.65, 0.239, 136.35],
      coordinateRotation: 180,
      floors: ['Основной', '2 этаж'],
    })
  })

  it('keeps floor extents with building bounds and marks floors without own tiles', () => {
    const configs = adaptMapRenderingConfigs([{
      normalizedName: 'customs',
      maps: [{
        key: 'customs',
        tilePath: 'https://assets.tarkov.dev/maps/customs/main/{z}/{x}/{y}.png',
        heightRange: [-1000, 1000],
        layers: [
          { name: '2nd Floor', tilePath: 'https://assets.tarkov.dev/maps/customs/2nd/{z}/{x}/{y}.png', extents: [{ height: [2.7, 6.5], bounds: [[[243, 190], [165, 125], 'dorms']] }] },
          { name: 'Underground', extents: { height: [-1000, 0.5] } },
        ],
      }],
    }])
    const layers = configs.get('customs')?.layers ?? []
    expect(layers[1]).toMatchObject({ name: '2 этаж', ownTiles: true, extents: [{ height: [2.7, 6.5], bounds: [[[243, 190], [165, 125]]] }] })
    expect(layers[2]).toMatchObject({ name: 'Подземный', ownTiles: false, extents: [{ height: [-1000, 0.5] }] })
  })
})
