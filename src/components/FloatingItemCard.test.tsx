import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { FloatingItemCard } from './FloatingItemCard'
import { resetRecognisedItemForTests, setRecognisedItem } from '../items/recognisedItem'
import type { ItemOverlayInfo } from '../overlay/types'

const propital: ItemOverlayInfo = {
  state: 'found', itemId: 'propital', name: 'Пропитал', shortName: 'Пропитал', fleaPrice: 41000, bestTrader: { name: 'Терапевт', price: 18000 },
  quests: [], kappa: false, collector: false, mate: false,
}
const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><FloatingItemCard /></MemoryRouter>)

afterEach(() => { cleanup(); resetRecognisedItemForTests() })

// Owner, 07.11.2026: «окно цены вылезало по всем вкладкам, не только на карте… окно цены будет появляться всегда, везде».
describe('the item key\'s price card on every tab', () => {
  it.each(['/', '/quests', '/flea', '/hideout/stash', '/quest-keys'])('shows on %s once an item is recognised', (path) => {
    const { container } = at(path)
    expect(screen.queryByRole('region', { name: 'Информация о предмете' })).toBeNull()
    act(() => setRecognisedItem(propital))
    expect(screen.getByRole('region', { name: 'Информация о предмете' })).toHaveTextContent('Пропитал')
    expect(container.querySelector('.floating-item-card .map-item-card')).not.toBeNull()
  })

  it('leaves «Карты» to the map\'s own card under «Вид», so it is never twice', () => {
    at('/maps/customs')
    act(() => setRecognisedItem(propital))
    expect(screen.queryByRole('region', { name: 'Информация о предмете' })).toBeNull()
  })
})
