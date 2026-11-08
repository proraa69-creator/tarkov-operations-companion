import '@testing-library/jest-dom/vitest'
import { act, cleanup, render } from '@testing-library/react'
import { CRS, type Map as LeafletMap } from 'leaflet'
import { useEffect } from 'react'
import { MapContainer, useMap } from 'react-leaflet'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapFloorWheelOn, parseTrialFeatures, setTrialFeatures } from '../account/trialFeatures'
import { MapFloorWheel } from './mapFloorWheel'

afterEach(() => { cleanup(); setTrialFeatures({ questTableScan: null, mapFloorWheel: null }) })

const FLOORS = ['Подвал', 'Основной', '2 этаж', '3 этаж']

function stage(floor: string, onPick: (floor: string) => void) {
  let map: LeafletMap | undefined
  function Grab() {
    const leaflet = useMap()
    useEffect(() => { map = leaflet }, [leaflet])
    return null
  }
  render(<MapContainer crs={CRS.Simple} center={[0, 0]} zoom={1} style={{ width: 400, height: 400 }}>
    <Grab />
    <MapFloorWheel floors={FLOORS} floor={floor} onPick={onPick} />
  </MapContainer>)
  return map!.getContainer()
}

const wheel = (target: HTMLElement, deltaY: number, altKey: boolean, timeStamp: number) => {
  const event = new WheelEvent('wheel', { deltaY, altKey, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  act(() => { target.dispatchEvent(event) })
  return event
}

describe('Alt + the wheel steps the floors (owner, 08.11.2026; the idea of report №55)', () => {
  it('up is the floor above, down the floor below; the map does not zoom', () => {
    const onPick = vi.fn()
    const map = stage('Основной', onPick)
    const up = wheel(map, -100, true, 1000)
    expect(onPick).toHaveBeenLastCalledWith('2 этаж')
    expect(up.defaultPrevented).toBe(true)
    wheel(map, 100, true, 2000)
    expect(onPick).toHaveBeenLastCalledWith('Подвал')
  })

  it('without Alt the wheel is the map\'s own; the rest of one flick is let go; nothing past the top', () => {
    const onPick = vi.fn()
    const map = stage('3 этаж', onPick)
    wheel(map, -100, false, 1000)
    wheel(map, -100, true, 2000)
    expect(onPick).not.toHaveBeenCalled()
    wheel(map, 100, true, 3000)
    wheel(map, 100, true, 3050)
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('is on only while the server says so for this account', () => {
    expect(mapFloorWheelOn()).toBe(false)
    setTrialFeatures(parseTrialFeatures({ features: { questTableScan: null, mapFloorWheel: '2100-01-01T00:00:00.000Z' } })!)
    expect(mapFloorWheelOn()).toBe(true)
    setTrialFeatures(parseTrialFeatures({ features: { questTableScan: null } })!)
    expect(mapFloorWheelOn()).toBe(false)
  })
})
