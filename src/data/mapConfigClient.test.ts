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
      floors: ['Основной', '2nd Floor'],
    })
  })
})
