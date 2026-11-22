import { afterEach, describe, expect, it, vi } from 'vitest'
import L from 'leaflet'
import { holdTooltipOnHover, TOOLTIP_HOLD_MS } from './holdTooltip'

/** Report 167 (owner, 15.11.2026): the mouse goes from a quest point on to the photo in its card. */
function setUp() {
  const box = document.createElement('div')
  document.body.append(box)
  const map = L.map(box, { center: [0, 0], zoom: 1 })
  const marker = L.marker([0, 0]).addTo(map).bindTooltip('<div class="mmt-place-photo">photo</div>')
  marker.on('tooltipopen', (event) => holdTooltipOnHover(marker, (event as L.TooltipEvent).tooltip))
  marker.fire('mouseover')
  return { map, marker, card: marker.getTooltip()!.getElement()! }
}

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

describe('a quest point\'s card', () => {
  it('waits for the mouse after it leaves the point, then closes', () => {
    vi.useFakeTimers()
    const { marker } = setUp()
    expect(marker.isTooltipOpen()).toBe(true)
    marker.fire('mouseout')
    expect(marker.isTooltipOpen()).toBe(true)
    vi.advanceTimersByTime(TOOLTIP_HOLD_MS + 10)
    expect(marker.isTooltipOpen()).toBe(false)
  })

  it('stays while the mouse is on its photo and closes when it leaves the card', () => {
    vi.useFakeTimers()
    const { marker, card } = setUp()
    const photo = card.querySelector('.mmt-place-photo')!
    marker.fire('mouseout')
    photo.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    vi.advanceTimersByTime(TOOLTIP_HOLD_MS * 3)
    expect(marker.isTooltipOpen()).toBe(true)
    photo.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    vi.advanceTimersByTime(TOOLTIP_HOLD_MS + 10)
    expect(marker.isTooltipOpen()).toBe(false)
  })

  it('coming back to the point keeps it', () => {
    vi.useFakeTimers()
    const { marker } = setUp()
    marker.fire('mouseout')
    marker.fire('mouseover')
    vi.advanceTimersByTime(TOOLTIP_HOLD_MS * 3)
    expect(marker.isTooltipOpen()).toBe(true)
  })
})
