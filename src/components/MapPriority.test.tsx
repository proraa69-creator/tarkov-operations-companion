import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { GameMap } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { MapPriority } from './MapPriority'

const n = (tasks: number, kills = 0) => ({ tasks, kills })
const maps = ['customs', 'woods', 'shoreline', 'interchange', 'reserve', 'lighthouse', 'streets', 'factory'].map((id) => ({ id, name: id, accent: '#fff' }) as GameMap)

function renderRow() {
  render(<LocaleProvider><MemoryRouter><MapPriority maps={maps} countFor={(id) => n(id === 'woods' ? 3 : 0)} onOpen={() => {}} /></MemoryRouter></LocaleProvider>)
  const row = document.querySelector('.map-priority-grid') as HTMLElement
  Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 1200 })
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: 700 })
  return row
}

describe('MapPriority', () => {
  it('shows every map, the busiest first', () => {
    renderRow()
    const tiles = document.querySelectorAll('.map-priority-tile')
    expect(tiles).toHaveLength(maps.length)
    expect(tiles[0]).toHaveAccessibleName(/woods/)
    // the count switch is the Overview's on the PC only
    expect(document.querySelector('.map-priority-filter')).toBeNull()
  })

  it('lights the chosen map, not the busiest one; the order stays by tasks (owner, 14.11.2026)', () => {
    const { rerender } = render(<LocaleProvider><MemoryRouter><MapPriority inline maps={maps} countFor={(id) => n(id === 'streets' ? 5 : id === 'shoreline' ? 2 : 0)} onOpen={() => {}} selectedId="shoreline" /></MemoryRouter></LocaleProvider>)
    const tiles = [...document.querySelectorAll('.map-priority-tile')]
    expect(tiles[0]).toHaveAccessibleName(/streets/)
    expect(tiles[0]).not.toHaveClass('is-top')
    expect(tiles[1]).toHaveAccessibleName(/shoreline/)
    expect(tiles[1]).toHaveClass('is-top')
    expect(tiles[1]).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelectorAll('.map-priority-tile.is-top')).toHaveLength(1)
    rerender(<LocaleProvider><MemoryRouter><MapPriority inline maps={maps} countFor={(id) => n(id === 'streets' ? 5 : id === 'shoreline' ? 2 : 0)} onOpen={() => {}} selectedId="factory" /></MemoryRouter></LocaleProvider>)
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

  describe('report 229: choosing a map does not move the row', () => {
    // jsdom has no layout: the row shows 0–600 px and each tile is 150 px wide, 6 px apart, moved by the row's scroll
    const lay = (row: HTMLElement) => {
      row.getBoundingClientRect = () => ({ left: 0, right: 600, top: 0, bottom: 50, width: 600, height: 50, x: 0, y: 0, toJSON: () => ({}) })
      row.querySelectorAll<HTMLElement>('.map-priority-tile').forEach((tile, index) => {
        tile.getBoundingClientRect = () => {
          const left = index * 156 - row.scrollLeft
          return { left, right: left + 150, top: 0, bottom: 50, width: 150, height: 50, x: left, y: 0, toJSON: () => ({}) }
        }
      })
    }
    const counts = (id: string) => n(maps.length - maps.findIndex((map) => map.id === id))

    it('a tile cut by the edge of the row stays under the pointer when clicked', () => {
      let selected = 'customs'
      const view = (id: string) => <LocaleProvider><MemoryRouter><MapPriority inline maps={maps} countFor={counts} selectedId={id} onOpen={(next) => { selected = next }} /></MemoryRouter></LocaleProvider>
      const { rerender } = render(view(selected))
      const row = document.querySelector('.map-priority-grid') as HTMLElement
      lay(row)
      row.scrollLeft = 200
      // «Резерв» (5th, 624–774 at scroll 0) shows 424–574: whole; «Маяк» (6th) shows 580–730: cut by the edge at 600
      fireEvent.click(screen.getByRole('button', { name: /lighthouse/ }))
      expect(selected).toBe('lighthouse')
      rerender(view(selected))
      expect(row.scrollLeft).toBe(200)
    })

    it('a map chosen elsewhere («Выбрать карту») out of sight comes into the row', () => {
      const view = (id: string) => <LocaleProvider><MemoryRouter><MapPriority inline maps={maps} countFor={counts} selectedId={id} onOpen={() => {}} /></MemoryRouter></LocaleProvider>
      const { rerender } = render(view('customs'))
      const row = document.querySelector('.map-priority-grid') as HTMLElement
      lay(row)
      // «Завод», the 8th tile, 1092–1242: the row scrolls by what is hidden
      rerender(view('factory'))
      expect(row.scrollLeft).toBe(642)
      // back to the 1st: the row returns to its start
      rerender(view('customs'))
      expect(row.scrollLeft).toBe(0)
    })
  })

  describe('report 230: «Все» / «Задания» / «Устранения»', () => {
    afterEach(() => localStorage.clear())
    const counts = (id: string) => id === 'lighthouse' ? n(2, 6) : id === 'woods' ? n(5, 3) : n(0)
    const tileNames = () => [...document.querySelectorAll('.map-priority-tile')].slice(0, 2).map((tile) => tile.getAttribute('aria-label'))

    it('orders the maps by the quests it counts and keeps the choice on this device', () => {
      render(<LocaleProvider><MemoryRouter><MapPriority inline filterable maps={maps} countFor={counts} selectedId="customs" onOpen={() => {}} /></MemoryRouter></LocaleProvider>)
      expect(screen.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'true')
      expect(tileNames()).toEqual(['woods · 8 заданий', 'lighthouse · 8 заданий'])
      act(() => { fireEvent.click(screen.getByRole('button', { name: 'Задания' })) })
      expect(tileNames()).toEqual(['woods · 5 заданий', 'lighthouse · 2 задания'])
      act(() => { fireEvent.click(screen.getByRole('button', { name: 'Устранения' })) })
      expect(tileNames()).toEqual(['lighthouse · 6 заданий', 'woods · 3 задания'])
      expect(screen.getByRole('button', { name: 'Устранения' })).toHaveAttribute('aria-pressed', 'true')
      expect(localStorage.getItem('raidos-map-priority-filter-v1')).toBe('kills')
    })

    it('without the switch (the phone) counts all quests, whatever was chosen', () => {
      localStorage.setItem('raidos-map-priority-filter-v1', 'tasks')
      render(<LocaleProvider><MemoryRouter><MapPriority inline maps={maps} countFor={counts} selectedId="customs" onOpen={() => {}} /></MemoryRouter></LocaleProvider>)
      expect(tileNames()).toEqual(['woods · 8 заданий', 'lighthouse · 8 заданий'])
    })
  })
})
