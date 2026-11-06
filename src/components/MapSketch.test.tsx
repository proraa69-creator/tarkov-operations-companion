import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CRS, type Map as LeafletMap } from 'leaflet'
import { useEffect } from 'react'
import { MapContainer, useMap } from 'react-leaflet'
import { beforeEach, describe, expect, it } from 'vitest'
import { setRenderLanguage, uiText } from '../i18n/renderText'
import { mapSketchKey, readMapSketch, useMapSketch, type MapSketch } from '../maps/mapSketch'
import { MapSketchLayer, MapSketchToolbar } from './MapSketch'

let leaflet: LeafletMap
let sketch: MapSketch
function Grab() {
  const map = useMap()
  useEffect(() => { leaflet = map }, [map])
  return null
}
function Stage() {
  const value = useMapSketch('p1', 'pvp', 'customs')
  useEffect(() => { sketch = value })
  return <>
    <MapSketchToolbar sketch={value} onBegin={() => {}} />
    <MapContainer crs={CRS.Simple} center={[0, 0]} zoom={1} zoomControl={false} attributionControl={false} style={{ width: 400, height: 400 }}>
      <Grab />
      <MapSketchLayer sketch={value} />
    </MapContainer>
  </>
}
const key = mapSketchKey('p1', 'pvp', 'customs')
const button = (name: string) => screen.getByRole('button', { name })
const container = () => leaflet.getContainer()
function press(pointerId: number, x: number, y: number, pointerType = 'mouse') { fireEvent.pointerDown(container(), { pointerId, button: 0, clientX: x, clientY: y, pointerType }) }
function move(pointerId: number, x: number, y: number) { fireEvent.pointerMove(container(), { pointerId, clientX: x, clientY: y }) }
function lift(pointerId: number, x: number, y: number) { fireEvent.pointerUp(container(), { pointerId, clientX: x, clientY: y }) }

describe('the pencil on the map', () => {
  beforeEach(() => localStorage.clear())

  it('only a pencil at first, no cross', () => {
    render(<Stage />)
    expect(button('Зарисовка')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Закрыть зарисовку' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ок' })).toBeNull()
  })

  it('while drawing the map does not move; a stroke is what lies between the press and the release, at the zoom it was drawn', () => {
    render(<Stage />)
    expect(leaflet.dragging.enabled()).toBe(true)
    fireEvent.click(button('Зарисовка'))
    expect(leaflet.dragging.enabled()).toBe(false)
    expect(container()).toHaveClass('is-sketching')
    expect(button('Назад')).toBeDisabled()
    expect(button('Вперёд')).toBeDisabled()

    press(1, 10, 10)
    move(1, 50, 10)
    move(1, 51, 10) // too close to add a point
    lift(1, 90, 10)
    expect(sketch.strokes).toHaveLength(1)
    expect(sketch.strokes[0]!.zoom).toBe(1)
    expect(sketch.strokes[0]!.points).toHaveLength(2)
    expect(button('Назад')).toBeEnabled()

    fireEvent.click(button('Назад'))
    expect(sketch.strokes).toHaveLength(0)
    fireEvent.click(button('Вперёд'))
    expect(sketch.strokes).toHaveLength(1)

    fireEvent.click(button('Ок'))
    expect(readMapSketch(key)).toHaveLength(1)
    expect(leaflet.dragging.enabled()).toBe(true)
    expect(container()).not.toHaveClass('is-sketching')
    expect(button('Закрыть зарисовку')).toBeInTheDocument()

    fireEvent.click(button('Закрыть зарисовку'))
    expect(sketch.strokes).toHaveLength(0)
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('«Отмена» leaves nothing of what was drawn', () => {
    render(<Stage />)
    fireEvent.click(button('Зарисовка'))
    press(1, 10, 10)
    lift(1, 10, 10)
    // A press without a move leaves a dot.
    expect(sketch.strokes[0]!.points).toHaveLength(2)
    fireEvent.click(button('Отмена'))
    expect(sketch.strokes).toHaveLength(0)
    expect(leaflet.dragging.enabled()).toBe(true)
    expect(screen.queryByRole('button', { name: 'Закрыть зарисовку' })).toBeNull()
  })

  it('a second finger means zoom: the stroke begun goes, nothing is drawn until the fingers are up', () => {
    render(<Stage />)
    fireEvent.click(button('Зарисовка'))
    press(1, 10, 10, 'touch')
    move(1, 40, 10)
    press(2, 80, 80, 'touch')
    move(1, 60, 10)
    lift(1, 60, 10)
    lift(2, 80, 80)
    expect(sketch.strokes).toHaveLength(0)
    press(3, 10, 10, 'touch')
    move(3, 40, 40)
    lift(3, 40, 40)
    expect(sketch.strokes).toHaveLength(1)
  })

  it('a stroke interrupted by the system is dropped, and the right button draws nothing', () => {
    render(<Stage />)
    fireEvent.click(button('Зарисовка'))
    press(1, 10, 10)
    fireEvent.pointerCancel(container(), { pointerId: 1, clientX: 20, clientY: 20 })
    fireEvent.pointerDown(container(), { pointerId: 2, button: 2, clientX: 10, clientY: 10, pointerType: 'mouse' })
    lift(2, 20, 20)
    expect(sketch.strokes).toHaveLength(0)
  })

  it('has its English', () => {
    setRenderLanguage('en')
    try {
      expect(['Зарисовка', 'Закрыть зарисовку', 'Назад', 'Вперёд', 'Ок', 'Отмена'].map((text) => uiText(text))).toEqual(['Drawing', 'Close the drawing', 'Back', 'Forward', 'OK', 'Cancel'])
    } finally { setRenderLanguage('ru') }
  })
})
