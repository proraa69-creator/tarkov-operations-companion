import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ModeProgress, Quest } from '../domain/types'
import { PhoneMapQuests, type PhoneQuestEntry } from './PhoneMapPanels'

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
})
