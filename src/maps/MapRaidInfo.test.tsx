import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapMarker } from '../domain/types'

const state = vi.hoisted(() => ({ raid: null as Record<string, unknown> | null }))
vi.mock('../app/useRaidState', async (original) => ({ ...(await original<typeof import('../app/useRaidState')>()), useRaidState: () => state.raid }))

import { MapExitsButton, MapRaidClock, MapRaidInfoSettings } from './MapRaidInfo'
import { RAID_LATE_MS, raidExitRows } from './raidInfoSettings'

/**
 * Report 239 (player, 25.11.2026): the raid's time and the raid's exits on the map, which is open the whole raid. Owner: the time
 * in Tarkov and what is left under «Отложенные квесты», red under 10 minutes; «Выходы» under «Ключи», open until pressed again —
 * the exits there are, the ones a flare opens, the car exit there or not.
 */
const exit = (id: string, title: string, extractFaction: MapMarker['extractFaction'] = 'pmc', extra: Partial<MapMarker> = {}): MapMarker =>
  ({ id, mapId: 'customs', type: 'extract', layerId: extractFaction === 'scav' ? 'extract.scav' : 'extract.pmc', extractFaction, extractId: id, title, description: '', position: [0, 0], ...extra }) as MapMarker
const MARKERS: MapMarker[] = [
  exit('a', 'Блокпост ВС РФ'),
  exit('b', 'Старая АЗС'),
  exit('c', 'Улица Климова (Сигнал)'),
  exit('v', 'Автомобильный выход (V-Ex)'),
  exit('s', 'Лагерь Диких', 'scav'),
  exit('k', 'Совместный выход', 'coop'),
  { ...exit('t', 'Переход на карту Завод'), layerId: 'transit' },
  { ...exit('x', 'Чужая карта'), mapId: 'woods' },
]

describe('raidExitRows', () => {
  it('after the game\'s list was read: the exits it named, every flare exit and the car exit, named ones first', () => {
    const rows = raidExitRows(MARKERS, 'customs', 'pmc', { lit: new Set(['a', 'k']), dim: new Set(['b', 'c', 'v']) })
    expect(rows.map((row) => [row.title, row.state, row.flare, row.car])).toEqual([
      ['Блокпост ВС РФ', 'open', false, false],
      ['Совместный выход', 'open', false, false],
      ['Улица Климова (Сигнал)', 'closed', true, false],
      ['Автомобильный выход (V-Ex)', 'closed', false, true],
    ])
  })

  it('nothing read yet: every exit of the side, none known; a Scav\'s raid has the Scavs\' and the shared ones', () => {
    expect(raidExitRows(MARKERS, 'customs', 'pmc', null).map((row) => `${row.id}:${row.state}`).sort()).toEqual(['a:unknown', 'b:unknown', 'c:unknown', 'k:unknown', 'v:unknown'])
    expect(raidExitRows(MARKERS, 'customs', 'scav', null).map((row) => row.id).sort()).toEqual(['k', 's'])
  })
})

describe('MapRaidClock', () => {
  const NOW = Date.parse('2026-11-25T15:00:00.000Z')
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers(); state.raid = null })
  const maps = [{ id: 'customs', name: 'Таможня', raidTime: 40 }]
  const raidLeft = (left: number) => { state.raid = { inRaid: true, since: NOW - (40 * 60_000 - left), begun: NOW - (40 * 60_000 - left), location: 'bigmap' } }

  it('the time in Tarkov always; in a raid what is left of it, red under 10 minutes', () => {
    const { container, rerender } = render(<MapRaidClock maps={maps} />)
    expect(container.querySelector('.map-raid-clock-line')?.getAttribute('title')).toBe('Время в Таркове')
    expect(container.querySelector('.is-raid')).toBeNull()
    raidLeft(RAID_LATE_MS + 5 * 60_000)
    rerender(<MapRaidClock maps={maps} />)
    expect(screen.getByText('До конца рейда')).toBeTruthy()
    expect(container.querySelector('.is-raid.is-late')).toBeNull()
    raidLeft(RAID_LATE_MS - 60_000)
    act(() => { vi.advanceTimersByTime(1000) })
    rerender(<MapRaidClock maps={maps} />)
    expect(container.querySelector('.is-raid.is-late')).not.toBeNull()
  })
})

describe('MapExitsButton', () => {
  beforeEach(() => localStorage.clear())

  it('opens its list and keeps it open until it is pressed again', () => {
    const rows = raidExitRows(MARKERS, 'customs', 'pmc', { lit: new Set(['a', 'v']), dim: new Set(['b', 'c']) })
    const { container, rerender } = render(<MapExitsButton rows={rows} scanned />)
    expect(container.querySelector('.map-exits-list')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Выходы/ }))
    expect(container.querySelectorAll('.map-exits-row')).toHaveLength(3)
    // the car exit says whether it is there, the flare exit what it needs
    expect(container.querySelector('.map-exits-tag.is-car')?.textContent).toBe('есть')
    expect(screen.getByText('сигнальный патрон')).toBeTruthy()
    rerender(<MapExitsButton rows={rows} scanned />)
    expect(container.querySelector('.map-exits-list')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Выходы/ }))
    expect(container.querySelector('.map-exits-list')).toBeNull()
  })

  it('nothing read yet: how to read the raid\'s exits, and the car exit unknown', () => {
    render(<MapExitsButton rows={raidExitRows(MARKERS, 'customs', 'pmc', null)} scanned={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Выходы/ }))
    expect(screen.getByText('Дважды O в игре — выходы рейда')).toBeTruthy()
    expect(document.querySelector('.map-exits-tag.is-car')?.textContent).toBe('?')
  })
})

describe('MapRaidInfoSettings', () => {
  beforeEach(() => localStorage.clear())

  it('«Оставшееся время рейда» and «Список выходов» are on until turned off', () => {
    render(<MapRaidInfoSettings />)
    const switches = screen.getAllByRole('switch')
    expect(switches.map((button) => button.getAttribute('aria-checked'))).toEqual(['true', 'true'])
    fireEvent.click(switches[1]!)
    expect(screen.getAllByRole('switch').map((button) => button.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    expect(localStorage.getItem('raidos-map-exits-list-v1')).toBe('off')
  })
})
