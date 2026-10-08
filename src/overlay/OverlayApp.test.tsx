import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { OverlayApp } from './OverlayApp'
import { PLAYER_FLOOR_HINT } from '../data/useAutoFloor'

const map = vi.hoisted(() => ({
  invalidateSize: vi.fn(), fitBounds: vi.fn(), on: vi.fn(), off: vi.fn(), getContainer: () => document.createElement('div'),
  // The player marker follows the position: zoom once, pan near the edge, turn the arrow.
  setView: vi.fn(), panTo: vi.fn(), getZoom: () => 2, getMaxZoom: () => 6, getSize: () => ({ x: 420, y: 300 }), latLngToContainerPoint: () => ({ x: 210, y: 150 }),
  // Quest buttons fly to the quest's rooms; the remembered view reads the centre.
  flyTo: vi.fn(), flyToBounds: vi.fn(), getCenter: () => ({ lat: 12, lng: 34 }),
}))
/** The props the last map was created with (centre/zoom of a remembered view, or the whole map's bounds). */
const created = vi.hoisted(() => ({ props: {} as Record<string, unknown> }))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, ...props }: { children: ReactNode }) => { created.props = props; return <div>{children}</div> },
  ImageOverlay: () => null, Marker: () => null, Pane: ({ children }: { children: ReactNode }) => <>{children}</>,
  // Tile layers leave their address in the page, so a test can see which floor is drawn.
  TileLayer: ({ url }: { url: string }) => <i data-testid="tiles" data-url={url} />,
  useMap: () => map,
}))
const listeners = new Map<string, (payload: unknown) => void>()
const zones = vi.fn(), resize = vi.fn(), updateSettings = vi.fn(), drag = vi.fn(), toggle = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  listeners.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 30, width: 400, height: 30, toJSON: () => ({}) })
  window.tarkovDesktop = {
    onOverlay: (channel: string, callback: (payload: unknown) => void) => { listeners.set(channel, callback); return () => listeners.delete(channel) },
    overlayZones: zones, overlayResize: resize, overlayDrag: drag,
    experimental: { updateSettings, toggleMinimap: toggle },
  } as unknown as NonNullable<Window['tarkovDesktop']>
})
afterEach(() => { delete window.tarkovDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals() })
function ready() {
  act(() => listeners.get('overlay:minimap')?.({ state: 'ready', map: { id: 'woods', name: 'Лес', layers: [] }, markers: [], opacity: 0.55, minimapWidth: 420 }))
}

describe('minimap controls after reopening', () => {
  it('re-sends mouse zones, fits the window and invalidates Leaflet without changing width', async () => {
    render(<OverlayApp kind="minimap" />)
    ready()
    await waitFor(() => expect(resize).toHaveBeenCalled())
    const initialMapCalls = map.invalidateSize.mock.calls.length
    const initialZones = zones.mock.calls.length
    const initialResize = resize.mock.calls.length
    act(() => listeners.get('overlay:visibility')?.(false))
    act(() => listeners.get('overlay:visibility')?.(true))
    await waitFor(() => expect(resize.mock.calls.length).toBeGreaterThan(initialResize))
    expect(map.invalidateSize.mock.calls.length).toBeGreaterThan(initialMapCalls)
    expect(zones.mock.calls.length).toBeGreaterThan(initialZones)
    expect(zones).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ width: 400, height: 30 })]))
    expect(screen.getByRole('slider', { name: 'Размер мини-карты' })).toHaveValue('420')
  })
  it('updates opacity and size immediately and persists both values; close calls the toggle', () => {
    const { container } = render(<OverlayApp kind="minimap" />)
    ready()
    fireEvent.change(screen.getByRole('slider', { name: 'Прозрачность' }), { target: { value: '70' } })
    expect(updateSettings).toHaveBeenCalledWith({ minimapOpacity: 0.7 })
    expect((container.querySelector('.ov-minimap') as HTMLElement).style.getPropertyValue('--ov-opacity')).toBe('0.7')
    fireEvent.change(screen.getByRole('slider', { name: 'Размер мини-карты' }), { target: { value: '520' } })
    expect(updateSettings).toHaveBeenCalledWith({ minimapWidth: 520 })
    expect(container.querySelector('.ov-minimap')).toHaveStyle({ width: '520px' })
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть мини-карту' }))
    expect(toggle).toHaveBeenCalledOnce()
  })
})

/** Factory with its floors as the live catalog has them: heights from tarkov.dev, each floor with its own render tiles. */
const tiles = (floor: string) => `https://assets.tarkov.dev/maps/factory/${floor}/{z}/{x}/{y}.png`
const factory = {
  id: 'factory', name: 'Завод', tileUrl: tiles('main'),
  floors: ['Основной', '2 этаж', '3 этаж', 'Тоннели'],
  layers: [
    { id: 'main', name: 'Основной', tileUrl: tiles('main'), heightRange: [-1, 3], ownTiles: true },
    { id: 'layer-0', name: '2 этаж', tileUrl: tiles('2nd'), extents: [{ height: [3, 6] }], ownTiles: true },
    { id: 'layer-1', name: '3 этаж', tileUrl: tiles('3rd'), extents: [{ height: [6, 10000] }], ownTiles: true },
    { id: 'layer-2', name: 'Тоннели', tileUrl: tiles('tunnels'), extents: [{ height: [-10000, -1] }], ownTiles: true },
  ],
}
const openFactory = () => act(() => listeners.get('overlay:minimap')?.({ state: 'ready', map: factory, view: 'satellite', markers: [], questCount: 0, opacity: 0.9, minimapWidth: 420 }))
const sendPosition = (y: number, at: number) => act(() => listeners.get('overlay:position')?.({ x: 10, y, z: 10, yaw: 0, at }))
const floorButton = (name: string) => screen.getByRole('button', { name })
const drawnTiles = () => screen.getAllByTestId('tiles').map((element) => element.dataset.url)

describe('minimap floor from the screenshot', () => {
  it('opens on the floor the player is on and draws that floor', () => {
    render(<OverlayApp kind="minimap" />)
    openFactory()
    expect(floorButton('Основной')).toHaveAttribute('aria-pressed', 'true')
    expect(drawnTiles()).toEqual([tiles('main')])
    sendPosition(4, 1000)
    expect(floorButton('2 этаж')).toHaveAttribute('aria-pressed', 'true')
    expect(floorButton('2 этаж')).toHaveAttribute('title', PLAYER_FLOOR_HINT)
    expect(drawnTiles()).toEqual([tiles('main'), tiles('2nd')])
    // The window lets clicks through everywhere but its controls: the floor buttons are one of them.
    expect(floorButton('3 этаж').closest('.ov-interactive')).not.toBeNull()
  })

  it('keeps a floor clicked by hand when the minimap opens again, until the next screenshot', () => {
    render(<OverlayApp kind="minimap" />)
    openFactory()
    sendPosition(4, 1000)
    fireEvent.click(floorButton('3 этаж'))
    expect(floorButton('3 этаж')).toHaveAttribute('aria-pressed', 'true')
    expect(drawnTiles()).toEqual([tiles('main'), tiles('3rd')])
    // Opening the minimap again sends the map and the last position again: nothing changes.
    openFactory()
    sendPosition(4, 1000)
    expect(floorButton('3 этаж')).toHaveAttribute('aria-pressed', 'true')
    expect(floorButton('2 этаж')).toHaveAttribute('title', PLAYER_FLOOR_HINT)
    // A new screenshot: the player went down into the tunnels.
    sendPosition(-2, 2000)
    expect(floorButton('Тоннели')).toHaveAttribute('aria-pressed', 'true')
    expect(drawnTiles()).toEqual([tiles('main'), tiles('tunnels')])
  })

  it('shows no floor buttons for a map with one level', () => {
    render(<OverlayApp kind="minimap" />)
    ready()
    expect(screen.queryByRole('group', { name: 'Этаж карты' })).toBeNull()
  })

  it('names the floors and the hint in English when the app is in English', async () => {
    const { setRenderLanguage } = await import('../i18n/renderText')
    setRenderLanguage('en')
    try {
      render(<OverlayApp kind="minimap" />)
      openFactory()
      sendPosition(-2, 1000)
      expect(screen.getByRole('group', { name: 'Map floor' })).toBeInTheDocument()
      expect(floorButton('Tunnels')).toHaveAttribute('aria-pressed', 'true')
      expect(floorButton('Tunnels')).toHaveAttribute('title', 'You are on this floor (from the last screenshot)')
      expect(floorButton('Main')).toHaveAttribute('aria-pressed', 'false')
      expect(floorButton('Floor 2')).toBeInTheDocument()
    } finally {
      setRenderLanguage('ru')
    }
  })
})

/** Handlers the minimap registered on the Leaflet map for an event. */
const mapHandlers = (event: string) => map.on.mock.calls.filter(([name]) => name === event).map(([, handler]) => handler as () => void)

describe('minimap view remembered per map', () => {
  afterEach(() => window.localStorage.clear())

  it('saves the centre and zoom only after the player moved the map by hand', () => {
    render(<OverlayApp kind="minimap" />)
    ready()
    // A move made by the app (following the player, a quest button) is not saved.
    act(() => mapHandlers('moveend').forEach((handler) => handler()))
    expect(window.localStorage.getItem('raidos.minimap.views.v1')).toBeNull()
    act(() => { mapHandlers('dragstart').forEach((handler) => handler()); mapHandlers('moveend').forEach((handler) => handler()) })
    expect(JSON.parse(window.localStorage.getItem('raidos.minimap.views.v1')!)).toEqual({ woods: { center: [12, 34], zoom: 2 } })
  })

  it('opens the map at the saved view and keeps its zoom while following the player', () => {
    window.localStorage.setItem('raidos.minimap.views.v1', JSON.stringify({ factory: { center: [5, 6], zoom: 3.5 } }))
    render(<OverlayApp kind="minimap" />)
    openFactory()
    expect(created.props).toMatchObject({ center: [5, 6], zoom: 3.5 })
    expect(created.props.bounds).toBeUndefined()
    sendPosition(1, 1000)
    // The player marker is inside the window: no jump to the player's zoom.
    expect(map.setView).not.toHaveBeenCalled()
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('opens a map without a saved view on the whole map and zooms to the player as before', () => {
    render(<OverlayApp kind="minimap" />)
    openFactory()
    expect(created.props).toHaveProperty('bounds')
    expect(created.props.center).toBeUndefined()
    sendPosition(1, 1000)
    expect(map.setView).toHaveBeenCalledOnce()
  })
})

describe('quest button steps through the rooms of the quest', () => {
  const quest = (id: string, z: number, x: number, height?: number) => ({ id, position: [z, x], layerId: 'quest.item', title: id, questId: 'q1', height })
  const openWithQuest = () => act(() => listeners.get('overlay:minimap')?.({
    state: 'ready', map: { id: 'woods', name: 'Лес', layers: [] }, opacity: 0.9, minimapWidth: 420, questCount: 1,
    // Two shelves of one room, a far building, and the same spot one storey up.
    markers: [quest('shelf-a', 0, 0, 1), quest('shelf-b', 3, 4, 1.5), quest('far', 200, 150, 1), quest('upstairs', 1, 1, 5)],
    quests: [{ questId: 'q1', name: 'Задание', trader: 'Прапор', markerIds: ['shelf-a', 'shelf-b', 'far', 'upstairs'], objectives: ['Найти'] }],
  }))
  const press = () => fireEvent.click(screen.getByRole('button', { name: 'Задание' }))

  it('flies room by room, then shows the whole map, then starts again', () => {
    render(<OverlayApp kind="minimap" />)
    openWithQuest()
    press()
    expect(map.flyToBounds).toHaveBeenLastCalledWith([[0, 0], [3, 4]], expect.anything())
    expect(screen.getByText('Точка 1 из 3')).toBeInTheDocument()
    press()
    expect(map.flyTo).toHaveBeenLastCalledWith([200, 150], expect.any(Number), expect.anything())
    press()
    expect(map.flyTo).toHaveBeenLastCalledWith([1, 1], expect.any(Number), expect.anything())
    expect(map.fitBounds).not.toHaveBeenCalled()
    press()
    expect(map.fitBounds).toHaveBeenCalledOnce()
    expect(screen.getByText('Вся карта')).toBeInTheDocument()
    press()
    expect(map.flyToBounds).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Задание' })).toHaveAttribute('aria-pressed', 'true')
    // A new payload (the minimap opened again) does not move the map.
    openWithQuest()
    expect(map.flyToBounds).toHaveBeenCalledTimes(2)
  })

  it('the clear button takes the quest off and shows the whole map', () => {
    render(<OverlayApp kind="minimap" />)
    openWithQuest()
    press()
    fireEvent.click(screen.getByRole('button', { name: 'Снять выбор задания' }))
    expect(map.fitBounds).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Задание' })).toHaveAttribute('aria-pressed', 'false')
    // The next press starts at the first room again.
    press()
    expect(map.flyToBounds).toHaveBeenCalledTimes(2)
  })

  it('names the step and the clear button in English', async () => {
    const { setRenderLanguage } = await import('../i18n/renderText')
    setRenderLanguage('en')
    try {
      render(<OverlayApp kind="minimap" />)
      openWithQuest()
      fireEvent.click(screen.getAllByRole('button', { pressed: false }).find((button) => button.closest('.ov-quest-list'))!)
      expect(screen.getByText('Point 1 of 3')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Clear quest selection' })).toBeInTheDocument()
    } finally {
      setRenderLanguage('ru')
    }
  })
})
