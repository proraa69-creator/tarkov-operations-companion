import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { CRS, type Map as LeafletMap } from 'leaflet'
import { useEffect, type ReactNode } from 'react'
import { MapContainer, useMap } from 'react-leaflet'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reloadRemoteFeaturesForTests, setRemoteFeatures } from '../announcement/features'
import { LivePlayerMarker, useFollowPlayer, type LivePlayer } from '../components/LivePlayerMarker'
import type { PlayerPosition } from '../overlay/screenshotPosition'
import { isPlayerFollowOn, setPlayerFollowOn } from './playerFollow'
import { PlayerFollowSetting } from './PlayerFollowSetting'

const shot = (at: number, x = 300, z = -200): PlayerPosition => ({ x, y: 0, z, yaw: 0, at })

let map: LeafletMap | undefined
function Grab() {
  const leaflet = useMap()
  useEffect(() => { map = leaflet }, [leaflet])
  return null
}

/** The map as the page opens it: far from where the player stands, at zoom 1. */
const Stage = ({ children }: { children?: ReactNode }) => (
  <MapContainer crs={CRS.Simple} center={[0, 0]} zoom={1} zoomControl={false} attributionControl={false} style={{ width: 400, height: 400 }}>
    <Grab />
    {children}
  </MapContainer>
)

function Follower({ position, enabled }: { position: PlayerPosition | null; enabled: boolean }) {
  useFollowPlayer(position, true, enabled)
  return null
}

const desktopPlayer = (position: PlayerPosition): LivePlayer => ({ source: 'desktop', position, onThisMap: true, raidMapId: 'customs', guessed: false, reason: 'raid-map' })

beforeEach(() => setRemoteFeatures({ minimap: true, minimapChangedAt: '' }))
afterEach(() => { map = undefined; delete window.tarkovDesktop; localStorage.clear(); reloadRemoteFeaturesForTests(); vi.restoreAllMocks() })

describe('«Приближать карту к точке» (owner, 20.11.2026): the stored switch', () => {
  it('is on by default, as before; off is kept on this device until turned on again', () => {
    expect(isPlayerFollowOn()).toBe(true)
    setPlayerFollowOn(false)
    expect(isPlayerFollowOn()).toBe(false)
    expect(localStorage.getItem('raidos-map-follow-player-v1')).toBe('off')
    setPlayerFollowOn(true)
    expect(isPlayerFollowOn()).toBe(true)
    expect(localStorage.getItem('raidos-map-follow-player-v1')).toBeNull()
  })
})

describe('«Настройки карты» → «Местоположение»', () => {
  it('the PC app: the switch shows on and turns the following off and on', () => {
    window.tarkovDesktop = { experimental: {} } as unknown as NonNullable<Window['tarkovDesktop']>
    render(<PlayerFollowSetting />)
    expect(screen.getByText('Местоположение')).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Приближать карту к точке' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(isPlayerFollowOn()).toBe(false)
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(isPlayerFollowOn()).toBe(true)
  })

  it('no switch where there is no dot: a browser without the PC app, or the position off for everybody', () => {
    const { container, unmount } = render(<PlayerFollowSetting />)
    expect(container).toBeEmptyDOMElement()
    unmount()
    window.tarkovDesktop = { experimental: {} } as unknown as NonNullable<Window['tarkovDesktop']>
    setRemoteFeatures({ minimap: false, minimapChangedAt: 'x' })
    expect(render(<PlayerFollowSetting />).container).toBeEmptyDOMElement()
  })
})

describe('a new screenshot and the map', () => {
  it('on: the first position centres the map on the dot, a later one near the edge pans to it', () => {
    const { rerender } = render(<Stage><Follower position={null} enabled /></Stage>)
    const setView = vi.spyOn(map!, 'setView')
    const panTo = vi.spyOn(map!, 'panTo')
    rerender(<Stage><Follower position={shot(1000)} enabled /></Stage>)
    expect(setView).toHaveBeenCalledTimes(1)
    expect(setView.mock.calls[0][0]).toMatchObject({ lat: -200, lng: 300 })
    expect(map!.getCenter()).toMatchObject({ lat: -200, lng: 300 })
    rerender(<Stage><Follower position={shot(2000, 900, -900)} enabled /></Stage>)
    expect(panTo).toHaveBeenCalledTimes(1)
    expect(panTo.mock.calls[0][0]).toMatchObject({ lat: -900, lng: 900 })
  })

  it('off: the map keeps its zoom and place, screenshot after screenshot', () => {
    const { rerender } = render(<Stage><Follower position={null} enabled={false} /></Stage>)
    const setView = vi.spyOn(map!, 'setView')
    const panTo = vi.spyOn(map!, 'panTo')
    const flyTo = vi.spyOn(map!, 'flyTo')
    rerender(<Stage><Follower position={shot(1000)} enabled={false} /></Stage>)
    rerender(<Stage><Follower position={shot(2000, 900, -900)} enabled={false} /></Stage>)
    expect(setView).not.toHaveBeenCalled()
    expect(panTo).not.toHaveBeenCalled()
    expect(flyTo).not.toHaveBeenCalled()
    expect(map!.getCenter()).toMatchObject({ lat: 0, lng: 0 })
    expect(map!.getZoom()).toBe(1)
  })

  it('turned on again: nothing moves until the next screenshot, which centres on the dot', () => {
    const { rerender } = render(<Stage><Follower position={shot(1000)} enabled={false} /></Stage>)
    const setView = vi.spyOn(map!, 'setView')
    rerender(<Stage><Follower position={shot(1000)} enabled /></Stage>)
    expect(setView).not.toHaveBeenCalled()
    rerender(<Stage><Follower position={shot(2000, 50, -60)} enabled /></Stage>)
    expect(setView).toHaveBeenCalledTimes(1)
    expect(map!.getCenter()).toMatchObject({ lat: -60, lng: 50 })
  })

  it('the PC\'s marker reads the switch: off, the dot is drawn and the map stays; on, the map comes to it', async () => {
    setPlayerFollowOn(false)
    const { container, unmount } = render(<Stage><LivePlayerMarker player={desktopPlayer(shot(1000))} /></Stage>)
    expect(container.querySelector('.live-player')).not.toBeNull()
    expect(map!.getCenter()).toMatchObject({ lat: 0, lng: 0 })
    expect(map!.getZoom()).toBe(1)
    unmount()

    setPlayerFollowOn(true)
    render(<Stage><LivePlayerMarker player={desktopPlayer(shot(1000))} /></Stage>)
    await act(async () => {})
    expect(map!.getCenter()).toMatchObject({ lat: -200, lng: 300 })
    expect(map!.getZoom()).toBe(1)
  })
})
