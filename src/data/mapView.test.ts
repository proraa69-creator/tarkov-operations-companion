import { beforeEach, describe, expect, it } from 'vitest'
import type { GameMap } from '../domain/types'
import { adaptMapRenderingConfigs } from './mapConfigClient'
import { MAP_VIEW_KEY, mapForView, mapViewSupport, planMapLayers, readMapView, resolveMapView, saveMapView } from './mapView'

const TILE = 'https://assets.tarkov.dev/maps/customs_0.16/main/{z}/{x}/{y}.png'
const SVG = 'https://assets.tarkov.dev/maps/svg/Customs.svg'

function customs(): GameMap {
  const config = adaptMapRenderingConfigs([{
    normalizedName: 'customs',
    maps: [{
      key: 'customs', tilePath: TILE, svgPath: SVG, svgLayer: 'Ground_Level',
      bounds: [[698, -307], [-372, 237]],
      layers: [
        { name: '2nd Floor', svgLayer: 'Second_Floor', tilePath: 'https://assets.tarkov.dev/maps/customs_0.16/2nd/{z}/{x}/{y}.png' },
        { name: '4th Floor', tilePath: 'https://assets.tarkov.dev/maps/customs_0.16/4th/{z}/{x}/{y}.png' },
        { name: 'Underground', svgLayer: 'Underground_Level' },
      ],
    }],
  }]).get('customs')!
  return { id: 'customs', name: 'Таможня', subtitle: '', raidTime: 40, players: '', difficulty: 'Средняя', accent: '#000', markerCount: 0, ...config }
}

function svgOnly(): GameMap {
  const config = adaptMapRenderingConfigs([{ normalizedName: 'lighthouse', maps: [{ key: 'lighthouse', svgPath: 'https://assets.tarkov.dev/maps/svg/Lighthouse.svg', svgLayer: 'Ground_Level', layers: [] }] }]).get('lighthouse')!
  return { id: 'lighthouse', name: 'Маяк', subtitle: '', raidTime: 40, players: '', difficulty: 'Высокая', accent: '#000', markerCount: 0, ...config }
}

describe('map view preference', () => {
  beforeEach(() => localStorage.removeItem(MAP_VIEW_KEY))

  it('defaults to the scheme (one style for all maps) and remembers the choice', () => {
    expect(readMapView()).toBe('digital')
    saveMapView('satellite')
    expect(readMapView()).toBe('satellite')
    localStorage.setItem(MAP_VIEW_KEY, 'nonsense')
    expect(readMapView()).toBe('digital')
  })

  it('knows which drawings a map has and falls back to the one it has', () => {
    expect(mapViewSupport(customs())).toEqual({ satellite: true, digital: true })
    expect(mapViewSupport(svgOnly())).toEqual({ satellite: false, digital: true })
    expect(resolveMapView(svgOnly(), 'satellite')).toBe('digital')
    expect(resolveMapView(customs(), 'digital')).toBe('digital')
  })
})

describe('map layer plan', () => {
  it('satellite: base tiles, own floor tiles or an SVG floor plan over the render', () => {
    const map = customs()
    expect(planMapLayers(map, 'satellite', 'Основной')).toMatchObject({ view: 'satellite', tileUrl: TILE, floorTileUrl: undefined, floorSvg: undefined, dimBase: false })
    expect(planMapLayers(map, 'satellite', '2 этаж')).toMatchObject({ floorTileUrl: expect.stringContaining('/2nd/'), floorSvg: undefined, dimBase: true })
    expect(planMapLayers(map, 'satellite', 'Подземный')).toMatchObject({ floorTileUrl: undefined, floorSvg: 'floor-only', dimBase: true })
  })

  it('digital: the SVG with the floor group, or floor tiles when the SVG has no such floor', () => {
    const map = customs()
    expect(planMapLayers(map, 'digital', 'Основной')).toMatchObject({ view: 'digital', imageUrl: SVG, floorSvg: undefined, dimBase: false })
    expect(planMapLayers(map, 'digital', 'Основной').tileUrl).toBeUndefined()
    expect(planMapLayers(map, 'digital', '2 этаж')).toMatchObject({ floorSvg: 'with-terrain', floorTileUrl: undefined, dimBase: false })
    expect(planMapLayers(map, 'digital', '4 этаж')).toMatchObject({ floorSvg: undefined, floorTileUrl: expect.stringContaining('/4th/'), dimBase: true })
  })

  it('places the SVG by svgBounds when tarkov.dev gives them (Reserve)', () => {
    const config = adaptMapRenderingConfigs([{ normalizedName: 'reserve', maps: [{ key: 'reserve', tilePath: 'https://t/{z}/{x}/{y}.png', svgPath: 'https://s/Reserve.svg', bounds: [[289, -293], [-303, 244]], svgBounds: [[289, -274], [-303, 272]] }] }]).get('reserve')!
    const map = { ...customs(), ...config, layers: config.layers }
    expect(map.svgBounds).toEqual([[289, -274], [-303, 272]])
    expect(planMapLayers(map, 'digital', 'Основной').imageBounds).toEqual([[289, -274], [-303, 272]])
    expect(mapForView(map, 'digital')).toMatchObject({ tileUrl: undefined, bounds: [[289, -274], [-303, 272]] })
    expect(mapForView(map, 'digital').layers?.every((layer) => !layer.tileUrl)).toBe(true)
    expect(mapForView(map, 'satellite')).toBe(map)
  })
})
