import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CRS, type Map as LeafletMap } from 'leaflet'
import { useEffect } from 'react'
import { MapContainer, useMap } from 'react-leaflet'
import { beforeEach, describe, expect, it } from 'vitest'
import { setRenderLanguage, uiText } from '../i18n/renderText'
import { mapSketchKey, readMapSketch, SKETCH_COLORS, useMapSketch, type MapSketch } from '../maps/mapSketch'
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

  it('the right button held moves the map while drawing and draws nothing; no menu (owner, 14.11.2026)', () => {
    render(<Stage />)
    fireEvent.click(button('Зарисовка'))
    const before = leaflet.getCenter()
    fireEvent.pointerDown(container(), { pointerId: 7, button: 2, clientX: 100, clientY: 100, pointerType: 'mouse' })
    expect(container()).toHaveClass('is-sketch-panning')
    fireEvent.pointerMove(container(), { pointerId: 7, clientX: 160, clientY: 130 })
    fireEvent.pointerUp(container(), { pointerId: 7, clientX: 160, clientY: 130 })
    expect(container()).not.toHaveClass('is-sketch-panning')
    const after = leaflet.getCenter()
    expect([after.lat !== before.lat, after.lng !== before.lng]).toEqual([true, true])
    expect(sketch.strokes).toHaveLength(0)
    expect(fireEvent.contextMenu(container())).toBe(false)
    // the left button still draws
    press(1, 10, 10); move(1, 50, 10); lift(1, 90, 10)
    expect(sketch.strokes).toHaveLength(1)
  })

  it('a drawing kept with ✓ goes to whoever listens (the squad: squad/squadLive.ts); closing it here does not take it from them', () => {
    const kept: Array<[string, number]> = []
    function Shared() {
      const value = useMapSketch('p1', 'pvp', 'customs', (mapId, strokes) => kept.push([mapId, strokes.length]))
      useEffect(() => { sketch = value })
      return <>
        <MapSketchToolbar sketch={value} onBegin={() => {}} />
        <MapContainer crs={CRS.Simple} center={[0, 0]} zoom={1} zoomControl={false} attributionControl={false} style={{ width: 400, height: 400 }}>
          <Grab />
          <MapSketchLayer sketch={value} />
        </MapContainer>
      </>
    }
    render(<Shared />)
    fireEvent.click(button('Зарисовка'))
    press(1, 10, 10); move(1, 50, 10); lift(1, 90, 10)
    expect(kept).toEqual([])
    fireEvent.click(button('Ок'))
    fireEvent.click(button('Закрыть зарисовку'))
    expect(kept).toEqual([['customs', 1]])
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

  it('the eraser: a stroke across a line splits it, as one step back, and draws nothing', () => {
    render(<Stage />)
    fireEvent.click(button('Зарисовка'))
    press(1, 10, 100)
    move(1, 390, 100)
    lift(1, 390, 100)
    expect(sketch.strokes).toHaveLength(1)

    fireEvent.click(button('Резинка'))
    expect(button('Резинка')).toHaveAttribute('aria-pressed', 'true')
    expect(button('Карандаш')).toHaveAttribute('aria-pressed', 'false')
    expect(container()).toHaveClass('is-erasing')
    press(2, 200, 40)
    move(2, 200, 100)
    // Shown while held, not yet a step.
    expect(container().querySelectorAll('path')).toHaveLength(2)
    expect(sketch.strokes).toHaveLength(1)
    move(2, 200, 160)
    lift(2, 200, 160)
    expect(sketch.strokes).toHaveLength(2)

    fireEvent.click(button('Назад'))
    expect(sketch.strokes).toHaveLength(1)
    fireEvent.click(button('Вперёд'))
    expect(sketch.strokes).toHaveLength(2)

    // Pressed where there is nothing: no step, and no line.
    fireEvent.click(button('Назад'))
    press(3, 200, 300)
    move(3, 220, 300)
    lift(3, 220, 300)
    expect(sketch.strokes).toHaveLength(1)
    expect(button('Вперёд')).toBeEnabled()

    fireEvent.click(button('Ок'))
    expect(container()).not.toHaveClass('is-erasing')
  })

  it('a second finger stops the eraser too, and what it had rubbed comes back', () => {
    render(<Stage />)
    fireEvent.click(button('Зарисовка'))
    press(1, 10, 100, 'touch')
    move(1, 390, 100)
    lift(1, 390, 100)
    fireEvent.click(button('Резинка'))
    press(2, 200, 100, 'touch')
    expect(container().querySelectorAll('path')).toHaveLength(2)
    press(3, 300, 300, 'touch')
    expect(container().querySelectorAll('path')).toHaveLength(1)
    lift(2, 200, 100)
    lift(3, 300, 300)
    expect(sketch.strokes).toHaveLength(1)
    expect(button('Вперёд')).toBeDisabled()
  })

  it('the colours: folded until pressed, a stroke is drawn in the one chosen, and it takes the pencil back', () => {
    render(<Stage />)
    fireEvent.click(button('Зарисовка'))
    expect(screen.queryByRole('button', { name: 'Жёлтый' })).toBeNull()
    fireEvent.click(button('Резинка'))
    fireEvent.click(button('Цвет'))
    expect(button('Красный')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(button('Жёлтый'))
    expect(screen.queryByRole('button', { name: 'Жёлтый' })).toBeNull()
    expect(button('Карандаш')).toHaveAttribute('aria-pressed', 'true')
    press(1, 10, 100)
    move(1, 90, 100)
    lift(1, 90, 100)
    expect(sketch.strokes[0]!.color).toBe('#ffd60a')
    expect(container().querySelector('path')).toHaveAttribute('stroke', '#ffd60a')
    fireEvent.click(button('Ок'))
    expect(readMapSketch(key)[0]!.color).toBe('#ffd60a')
  })

  it('a press anywhere else folds the colours', () => {
    render(<Stage />)
    fireEvent.click(button('Зарисовка'))
    fireEvent.click(button('Цвет'))
    expect(button('Белый')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('button', { name: 'Белый' })).toBeNull()
  })

  it('has its English', () => {
    setRenderLanguage('en')
    try {
      expect(['Зарисовка', 'Закрыть зарисовку', 'Назад', 'Вперёд', 'Ок', 'Отмена', 'Карандаш', 'Резинка', 'Цвет'].map((text) => uiText(text))).toEqual(['Drawing', 'Close the drawing', 'Back', 'Forward', 'OK', 'Cancel', 'Pencil', 'Eraser', 'Colour'])
      expect(SKETCH_COLORS.map(({ label }) => uiText(label))).toEqual(['Red', 'Yellow', 'Green', 'Light blue', 'Purple', 'White'])
    } finally { setRenderLanguage('ru') }
  })
})
