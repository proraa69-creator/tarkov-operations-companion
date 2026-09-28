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
})
