import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetRecognisedItemForTests, setRecognisedItem } from '../items/recognisedItem'
import { ITEM_TOAST_MS, PhoneItemToast } from './PhoneItemToast'

const card = (name: string) => ({ state: 'found' as const, itemId: name, name, shortName: name, fleaPrice: 12345, quests: [{ questId: 'q', name: 'Шоу', trader: 'Прапор', count: 2, kappa: false, purpose: 'сдать' }], kappa: true, collector: false })

describe('PhoneItemToast', () => {
  afterEach(() => { resetRecognisedItemForTests(); vi.useRealTimers() })

  it('shows the PC item for 10 s and replaces it with the next one', () => {
    vi.useFakeTimers()
    render(<PhoneItemToast />)
    act(() => setRecognisedItem(card('Гофра'), { at: 1, from: 'server' }))
    expect(screen.getByText('Гофра')).toBeTruthy()
    expect(screen.getByText(/Шоу ×2/)).toBeTruthy()
    act(() => setRecognisedItem(card('Свеча'), { at: 2, from: 'server' }))
    expect(screen.queryByText('Гофра')).toBeNull()
    expect(screen.getByText('Свеча')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(ITEM_TOAST_MS + 10) })
    expect(screen.queryByText('Свеча')).toBeNull()
  })

  it('ignores the items this device looked up itself', () => {
    render(<PhoneItemToast />)
    act(() => setRecognisedItem(card('Гофра'), { at: 3, from: 'pc' }))
    expect(screen.queryByText('Гофра')).toBeNull()
  })
})
