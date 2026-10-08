import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { OverlayApp } from './OverlayApp'

const map = vi.hoisted(() => ({ invalidateSize: vi.fn(), fitBounds: vi.fn(), on: vi.fn(), off: vi.fn(), getContainer: () => document.createElement('div') }))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ImageOverlay: () => null, Marker: () => null, TileLayer: () => null,
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
