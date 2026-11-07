import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ModeProgress, Quest } from '../domain/types'
import { PhoneMapFloors, PhoneMapQuests, type PhoneQuestEntry } from './PhoneMapPanels'

const quest = { id: 'q1', name: 'Первый квест', trader: 'Прапор', level: 5, kappa: false, description: '', objectives: [], rewards: [] } as unknown as Quest
const entries: PhoneQuestEntry[] = [{ quest }]

describe('«Квесты» on the phone map', () => {
  it('closing the quest window (✕) opens the list again to pick the next quest', () => {
    const onOpen = vi.fn()
    const props = { entries, mapId: 'customs', maps: [{ id: 'customs', name: 'Таможня' }], itemsById: new Map(), progress: {} as ModeProgress, onOpen }
    const { rerender, container } = render(<PhoneMapQuests {...props} hidden={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Квесты/ }))
    expect(container.querySelector('.phone-map-quests.is-open')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Первый квест/ }))
    expect(onOpen).toHaveBeenCalledWith(entries[0])
    // The quest window covers the map: the list hides…
    rerender(<PhoneMapQuests {...props} hidden />)
    expect(container.querySelector('.phone-map-quests')).toBeNull()
    // …and comes back open once the window is closed.
    rerender(<PhoneMapQuests {...props} hidden={false} />)
    expect(container.querySelector('.phone-map-quests.is-open')).not.toBeNull()
  })
  it('a quest with points on this map has the tick «Сделал в этом рейде»; one without points has none', () => {
    const onToggle = vi.fn()
    const pointless = { ...quest, id: 'q2', name: 'Второй квест' } as Quest
    const withPoint: PhoneQuestEntry[] = [{ quest, marker: { id: 'm1', questId: 'q1', mapId: 'customs', position: [0, 0], type: 'quest', title: 'Точка', description: '' } }, { quest: pointless }]
    const checks = { checked: (id: string) => id === 'q1', settled: () => false, onToggle, any: true, autoReset: false, onClear: vi.fn() }
    render(<PhoneMapQuests entries={withPoint} mapId="customs" maps={[{ id: 'customs', name: 'Таможня' }]} itemsById={new Map()} progress={{} as ModeProgress} onOpen={vi.fn()} hidden={false} checks={checks} />)
    const ticks = document.querySelectorAll('.quest-raid-check')
    expect(ticks).toHaveLength(1)
    expect(ticks[0]).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(ticks[0])
    expect(onToggle).toHaveBeenCalledWith('q1')
    expect(screen.getByRole('button', { name: 'Снять все галочки' })).toBeInTheDocument()
  })

  it('the floors are a button on the map: the list goes from the top floor down and picks one', () => {
    const onPick = vi.fn()
    render(<PhoneMapFloors floors={['Подземный', 'Основной', '2 этаж']} floor="Основной" playerFloor="2 этаж" onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: /Основной/ }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['2 этаж', 'Основной', 'Подземный'])
    fireEvent.click(screen.getByRole('option', { name: /Подземный/ }))
    expect(onPick).toHaveBeenCalledWith('Подземный')
  })
})
