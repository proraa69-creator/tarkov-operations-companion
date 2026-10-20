import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MapItemCard } from './MapItemCard'
import { resetRecognisedItemForTests, setRecognisedItem, recognisedItem } from '../items/recognisedItem'
import { setRenderLanguage } from '../i18n/renderText'
import type { ItemOverlayInfo } from '../overlay/types'

const propital: ItemOverlayInfo = {
  state: 'found', itemId: 'propital', name: 'Пропитал', shortName: 'Пропитал', iconUrl: 'https://assets.tarkov.dev/propital-icon.webp',
  fleaPrice: 41000, bestTrader: { name: 'Терапевт', price: 18000 },
  quests: [{ questId: 'q1', name: 'Санитарные нормы', trader: 'Терапевт', count: 2, kappa: true, purpose: 'сдать' }],
  kappa: true, collector: true, mate: true, mateNames: ['Friend_1', 'Friend_2'],
}

/** The map's HUD as MapsPage draws it: the map's name, «Вид», the tools, then the card on a line of its own. */
const hud = () => render(<div className="map-hud"><span>CUSTOMS</span><div className="map-view-toggle"><button type="button">ВИД</button></div><button type="button">Слои</button><MapItemCard /></div>)

afterEach(() => { cleanup(); resetRecognisedItemForTests(); setRenderLanguage('ru') })

describe('the recognised item on «Карты» (owner, 15.10.2026; Kappa and friends only, 20.10.2026)', () => {
  it('nothing until an item is recognised; then the card is the HUD\'s last part, after «Вид» and the controls', () => {
    const { container } = hud()
    expect(screen.queryByRole('region', { name: 'Информация о предмете' })).toBeNull()
    act(() => setRecognisedItem(propital))
    const card = screen.getByRole('region', { name: 'Информация о предмете' })
    const row = container.querySelector('.map-item-card-row')!
    expect(row.parentElement).toHaveClass('map-hud')
    expect(row.previousElementSibling).toHaveTextContent('Слои')
    expect(card.compareDocumentPosition(screen.getByText('ВИД')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('shows the picture and name, flea and trader price, «Каппа» and the friends who need it — no quests', () => {
    const { container } = hud()
    act(() => setRecognisedItem(propital))
    const card = screen.getByRole('region', { name: 'Информация о предмете' })
    expect(card.querySelector('img')).toHaveAttribute('src', propital.iconUrl)
    expect(card).toHaveTextContent('Пропитал')
    expect(card).toHaveTextContent(/Барахолка\s*41\s000 ₽/)
    expect(card).toHaveTextContent(/Терапевт\s*18\s000 ₽/)
    expect(card).not.toHaveTextContent('Санитарные нормы')
    expect(card).not.toHaveTextContent('сдать')
    expect(card.querySelector('.map-item-card-tag.is-kappa')).toHaveTextContent(/^Каппа$/)
    expect(card.querySelector('.map-item-card-tag.is-mate')).toHaveTextContent(/^Friend_1, Friend_2$/)
    // At the HUD's left edge, not under «Вид».
    expect((container.querySelector('.map-item-card-row') as HTMLElement).style.paddingLeft).toBe('')
  })

  it('needed by nobody: prices only, no Kappa or friend line; a friend without a known nickname is «Друг»', () => {
    hud()
    act(() => setRecognisedItem({ ...propital, collector: false, kappa: true, mate: false }))
    const card = screen.getByRole('region', { name: 'Информация о предмете' })
    expect(card.querySelector('.map-item-card-tags')).toBeNull()
    expect(card).not.toHaveTextContent('Каппа')
    act(() => setRecognisedItem({ ...propital, collector: false, mate: true, mateNames: [] }))
    expect(screen.getByRole('region').querySelector('.map-item-card-tag.is-mate')).toHaveTextContent(/^Друг$/)
  })

  it('«reading…» and «not recognised» states; the next item replaces it; «Закрыть» hides it until the next one', () => {
    hud()
    act(() => setRecognisedItem({ state: 'loading' }))
    expect(screen.getByRole('region')).toHaveTextContent('Распознаю предмет…')
    act(() => setRecognisedItem({ state: 'not-found' }))
    expect(screen.getByRole('region')).toHaveTextContent('Предмет не распознан')
    act(() => setRecognisedItem({ state: 'idle' }))
    expect(screen.getByRole('region')).toHaveTextContent('Предмет не распознан')
    act(() => setRecognisedItem(propital))
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('region')).toBeNull()
    expect(recognisedItem()).toBeNull()
    act(() => setRecognisedItem({ ...propital, name: 'Морфин' }))
    expect(screen.getByRole('region')).toHaveTextContent('Морфин')
  })

  it('in English', () => {
    setRenderLanguage('en')
    hud()
    act(() => setRecognisedItem({ ...propital, mate: false }))
    const card = screen.getByRole('region', { name: 'Item info' })
    expect(card.querySelector('.map-item-card-tag.is-kappa')).toHaveTextContent(/^Kappa$/)
    expect(card).toHaveTextContent('Flea market')
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})
