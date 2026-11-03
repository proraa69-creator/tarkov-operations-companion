import { describe, expect, it } from 'vitest'
import { selectSvgFloor } from './FloorSvgOverlay'
const layers = [{ id: 'main', name: 'Main', svgLayer: 'terrain' }, { name: '2', svgLayer: 'second' }, { name: '3', svgLayer: 'third' }]
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g id="terrain"/><g id="second"/><g id="third" style="display:none"/><script>alert(1)</script></svg>'
describe('SVG floor selection', () => {
  it('shows selected floor, hides other floors, and preserves the terrain', () => {
    const doc = new DOMParser().parseFromString(selectSvgFloor(svg, layers, '3'), 'image/svg+xml')
    expect(doc.getElementById('third')?.getAttribute('display')).toBe('inline')
    expect(doc.getElementById('second')?.getAttribute('display')).toBe('none')
    expect(doc.getElementById('terrain')?.getAttribute('display')).toBe('inline')
    expect(doc.querySelector('script')).toBeNull()
  })
  it('round trips without changing the original image', () => {
    expect(selectSvgFloor(svg, layers, '2')).toBe(selectSvgFloor(svg, layers, '2'))
    expect(selectSvgFloor(svg, layers, '2')).not.toBe(selectSvgFloor(svg, layers, '3'))
    expect(() => selectSvgFloor(svg, layers, 'missing')).toThrow()
  })
  it('draws only the selected floor over the satellite render', () => {
    const withKept = svg.replace('<g id="second"/>', '<g id="second"/><g id="kept"/>')
    const doc = new DOMParser().parseFromString(selectSvgFloor(withKept, layers, '2', { terrain: false }), 'image/svg+xml')
    expect(doc.getElementById('second')?.getAttribute('display')).toBe('inline')
    expect(doc.getElementById('terrain')?.getAttribute('display')).toBe('none')
    expect(doc.getElementById('kept')?.getAttribute('display')).toBe('none')
    expect(doc.getElementById('third')?.getAttribute('display')).toBe('none')
  })
  it('draws only the ground-floor rooms kept with the ground level (satellite main level)', () => {
    const withRooms = svg.replace('<g id="second"/>', '<g id="second"/><g id="rooms" data-keep-with-group="terrain"/>')
    const doc = new DOMParser().parseFromString(selectSvgFloor(withRooms, layers, 'Main', { interiors: true }), 'image/svg+xml')
    expect(doc.getElementById('rooms')?.getAttribute('display')).toBe('inline')
    expect(doc.getElementById('terrain')?.getAttribute('display')).toBe('none')
    expect(doc.getElementById('second')?.getAttribute('display')).toBe('none')
    expect(() => selectSvgFloor(svg, layers, 'Main', { interiors: true })).toThrow('no ground-floor interiors')
  })
  it('draws only the danger zones with the groups they sit in (satellite, every level)', () => {
    const withZones = '<svg xmlns="http://www.w3.org/2000/svg"><style>.danger{stroke:red}</style>'
      + '<g id="terrain"><g id="roads"/><g id="Minefield" class="danger"><path id="field"/></g><path id="rock"/></g>'
      + '<g id="second"><g id="mines" class="danger_small"/><g id="rooms"/></g><g id="third" style="display:none"/></svg>'
    const doc = new DOMParser().parseFromString(selectSvgFloor(withZones, layers, 'Main', { danger: true }), 'image/svg+xml')
    for (const id of ['terrain', 'Minefield', 'second', 'mines']) expect(doc.getElementById(id)?.getAttribute('display')).toBe('inline')
    for (const id of ['roads', 'rock', 'rooms', 'third']) expect(doc.getElementById(id)?.getAttribute('display')).toBe('none')
    expect(doc.getElementById('field')?.getAttribute('display')).toBeNull()
    expect(doc.querySelector('style')?.getAttribute('display')).toBeNull()
    expect(() => selectSvgFloor(svg, layers, 'Main', { danger: true })).toThrow('no danger zones')
  })
})
