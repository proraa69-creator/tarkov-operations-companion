import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { GameMap } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { MapPriority } from './MapPriority'

const maps = ['customs', 'woods', 'shoreline', 'interchange', 'reserve', 'lighthouse', 'streets', 'factory'].map((id) => ({ id, name: id, accent: '#fff' }) as GameMap)

function renderRow() {
  render(<LocaleProvider><MemoryRouter><MapPriority maps={maps} countFor={(id) => id === 'woods' ? 3 : 0} onOpen={() => {}} /></MemoryRouter></LocaleProvider>)
  const row = document.querySelector('.map-priority-grid') as HTMLElement
  Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 1200 })
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: 700 })
  return row
}

describe('MapPriority', () => {
  it('shows every map, the busiest first', () => {
    renderRow()
    expect(screen.getAllByRole('button')).toHaveLength(maps.length)
    expect(screen.getAllByRole('button')[0]).toHaveAccessibleName(/woods/)
  })

  it('lights the chosen map, not the busiest one; the order stays by tasks (owner, 14.11.2026)', () => {
    const { rerender } = render(<LocaleProvider><MemoryRouter><MapPriority inline maps={maps} countFor={(id) => id === 'streets' ? 5 : id === 'shoreline' ? 2 : 0} onOpen={() => {}} selectedId="shoreline" /></MemoryRouter></LocaleProvider>)
    const tiles = screen.getAllByRole('button')
    expect(tiles[0]).toHaveAccessibleName(/streets/)
    expect(tiles[0]).not.toHaveClass('is-top')
    expect(tiles[1]).toHaveAccessibleName(/shoreline/)
    expect(tiles[1]).toHaveClass('is-top')
    expect(tiles[1]).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelectorAll('.map-priority-tile.is-top')).toHaveLength(1)
    rerender(<LocaleProvider><MemoryRouter><MapPriority inline maps={maps} countFor={(id) => id === 'streets' ? 5 : id === 'shoreline' ? 2 : 0} onOpen={() => {}} selectedId="factory" /></MemoryRouter></LocaleProvider>)
    expect(document.querySelector('.map-priority-tile.is-top')).toHaveAccessibleName(/factory/)
  })

  it('scrolls the row sideways with the wheel while there is more to see, then lets the page scroll', () => {
    const row = renderRow()
    expect(fireEvent.wheel(row, { deltaY: 120 })).toBe(false)
    expect(row.scrollLeft).toBe(120)
    row.scrollLeft = 500
    // at the right end the wheel is the page's again
    expect(fireEvent.wheel(row, { deltaY: 120 })).toBe(true)
    expect(fireEvent.wheel(row, { deltaY: -120 })).toBe(false)
    expect(row.scrollLeft).toBe(380)
  })

  it('leaves the wheel alone when all maps fit', () => {
    const row = renderRow()
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 700 })
    expect(fireEvent.wheel(row, { deltaY: 120 })).toBe(true)
    expect(row.scrollLeft).toBe(0)
  })
})
