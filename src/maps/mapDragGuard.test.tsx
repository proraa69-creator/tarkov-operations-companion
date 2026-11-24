import '@testing-library/jest-dom/vitest'
import { fireEvent, render } from '@testing-library/react'
import { CRS, type Map as LeafletMap } from 'leaflet'
import { useEffect, useRef } from 'react'
import { MapContainer, useMap } from 'react-leaflet'
import { describe, expect, it } from 'vitest'
import { MapDragGuard } from './mapDragGuard'

describe('report №97: dragging the map from a point does not press the point', () => {
  it('is true once the map is dragged, false again at the next press', () => {
    let map: LeafletMap | undefined
    let guard: { current: boolean } | undefined
    function Grab() {
      const leaflet = useMap()
      useEffect(() => { map = leaflet }, [leaflet])
      return null
    }
    function Stage() {
      const dragged = useRef(false)
      guard = dragged
      return <MapContainer crs={CRS.Simple} center={[0, 0]} zoom={1} zoomControl={false} attributionControl={false} style={{ width: 400, height: 400 }}>
        <Grab />
        <MapDragGuard draggedRef={dragged} />
      </MapContainer>
    }
    render(<Stage />)
    const container = map!.getContainer()
    fireEvent.pointerDown(container)
    expect(guard!.current).toBe(false)
    map!.fire('dragstart')
    expect(guard!.current).toBe(true)
    // the next press is a new click
    fireEvent.mouseDown(container)
    expect(guard!.current).toBe(false)
  })
})
