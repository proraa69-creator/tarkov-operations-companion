import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameMap } from '../domain/types'
import { adaptMapRenderingConfigs } from '../data/mapConfigClient'
import { MarkerMiniMap } from './MarkerMiniMap'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Marker: () => null,
  Pane: ({ children }: { children: ReactNode }) => <>{children}</>,
  // Tile layers leave their address in the page, so the test sees which floor is drawn.
  TileLayer: ({ url }: { url: string }) => <i data-testid="tiles" data-url={url} />,
  useMap: () => ({ setView: () => {}, getMaxZoom: () => 6 }),
}))
// The scheme names the floor it shows.
vi.mock('./FloorSvgOverlay', () => ({ FloorSvgOverlay: ({ selected }: { selected: string }) => <b data-testid="scheme" data-floor={selected} /> }))

const TILE = 'https://raidos.app/v1/map-tiles/maps/customs_0.16/main/{z}/{x}/{y}.png'
const SECOND = 'https://assets.tarkov.dev/maps/customs_0.16/2nd/{z}/{x}/{y}.png'

function customs(): GameMap {
  const config = adaptMapRenderingConfigs([{
    normalizedName: 'customs',
    maps: [{
      key: 'customs', tilePath: TILE, svgPath: 'https://raidos.app/v1/map-tiles/maps/svg/Customs.svg', svgLayer: 'Ground_Level',
      bounds: [[698, -307], [-372, 237]],
      layers: [{ name: '2nd Floor', svgLayer: 'Second_Floor', tilePath: SECOND }],
    }],
  }]).get('customs')!
  return { id: 'customs', name: 'Таможня', subtitle: '', raidTime: 40, players: '', difficulty: 'Средняя', accent: '#000', markerCount: 0, ...config }
}

const tiles = () => screen.queryAllByTestId('tiles').map((tile) => tile.getAttribute('data-url'))

describe('quest point preview («Примерное место»)', () => {
  afterEach(cleanup)

  it('draws the floor the point is on, as the main map does (owner, 12.10.2026)', () => {
    render(<MarkerMiniMap map={customs()} view="satellite" floor="2 этаж" position={[10, 20]} color="#f00" />)
    // the ground level dimmed under the floor's own render (served from our mirror)
    expect(tiles()).toEqual([TILE, expect.stringContaining('/customs_0.16/2nd/')])
  })

  it('a ground-level point, or a floor the map does not have, shows the ground level only', () => {
    const { unmount } = render(<MarkerMiniMap map={customs()} view="satellite" position={[10, 20]} color="#f00" />)
    expect(tiles()).toEqual([TILE])
    unmount()
    render(<MarkerMiniMap map={customs()} view="satellite" floor="7 этаж" position={[10, 20]} color="#f00" />)
    expect(tiles()).toEqual([TILE])
  })

  it('in «Схема» the scheme shows the point\'s floor', () => {
    render(<MarkerMiniMap map={customs()} view="digital" floor="2 этаж" position={[10, 20]} color="#f00" />)
    expect(screen.getByTestId('scheme')).toHaveAttribute('data-floor', '2 этаж')
    expect(tiles()).toEqual([])
  })
})
