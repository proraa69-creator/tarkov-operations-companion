import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KEY_TURN_MS, RaidRequirementsPanel, type RaidNeedRow } from './RaidRequirementsPanel'
import { TakenItemsProvider } from '../overview/TakenItems'
import { setItemTaken } from '../progression/takenItems'

// Report №90: «ключ 219 или ключ 220» — one card, «+1», the keys taking turns (owner, 07.11.2026: «каждые 3 секунды менялась картинка»).
const either: RaidNeedRow = {
  key: 'any-of:generators', itemId: 'k219', name: 'Ключ 219', iconUrl: '/219.webp', href: '/maps/shoreline', count: 1,
  lines: [{ purpose: 'key', questNames: ['Нужно больше энергии'] }], fromRaidListOnly: false,
  alternatives: { title: 'Можно и этим ключом', items: [{ id: 'k220', name: 'Ключ 220', iconUrl: '/220.webp' }], badge: '+1', turn: true },
}

describe('either key in «Требования рейда»', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows one key with «+1», then the other in its turn', () => {
    const { container } = render(<MemoryRouter><RaidRequirementsPanel rows={[either]} /></MemoryRouter>)
    expect(container.querySelectorAll('.raid-need')).toHaveLength(1)
    expect(screen.getByText('Ключ 219')).toBeTruthy()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(container.querySelector('.raid-need img')?.getAttribute('src')).toBe('/219.webp')
    act(() => { vi.advanceTimersByTime(KEY_TURN_MS) })
    expect(screen.getByText('Ключ 220')).toBeTruthy()
    expect(container.querySelector('.raid-need img')?.getAttribute('src')).toBe('/220.webp')
    act(() => { vi.advanceTimersByTime(KEY_TURN_MS) })
    expect(screen.getByText('Ключ 219')).toBeTruthy()
  })

  it('stays on one key with reduced motion, and for any other choice', () => {
    const matchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      render(<MemoryRouter><RaidRequirementsPanel rows={[either, { ...either, key: 'scope', name: 'ELCAN', alternatives: { ...either.alternatives!, turn: undefined } }]} /></MemoryRouter>)
      act(() => { vi.advanceTimersByTime(KEY_TURN_MS * 2) })
      expect(screen.getByText('Ключ 219')).toBeTruthy()
      expect(screen.queryByText('Ключ 220')).toBeNull()
      expect(screen.getByText('ELCAN')).toBeTruthy()
    } finally {
      window.matchMedia = matchMedia
    }
  })
})
// Owner, 07.11.2026: «если он у меня есть… пишется «Есть в схроне». Если нету, то пишется «Нет в наличии»».
describe('a key the player has or not', () => {
  it('says «Есть в схроне» or «Нет в наличии», and nothing when not known', () => {
    const key = (stock?: 'owned' | 'missing'): RaidNeedRow => ({ ...either, key: `k-${stock}`, name: `Ключ ${stock}`, alternatives: undefined, stock })
    render(<MemoryRouter><RaidRequirementsPanel rows={[key('owned'), key('missing'), key(undefined)]} /></MemoryRouter>)
    expect(screen.getByText('Ключ owned').closest('.raid-need')).toHaveTextContent('Есть в схроне')
    expect(screen.getByText('Ключ missing').closest('.raid-need')).toHaveTextContent('Нет в наличии')
    expect(screen.getByText('Ключ undefined').closest('.raid-need')?.textContent).not.toMatch(/в схроне|в наличии/)
  })
})


// Owner, 15.11.2026: «Если я кликаю правой кнопкой, нажимаю «Взял», у меня статус переходит в «Есть в наличии»»; «Слово взять мы
// больше не пишем, только действие… Ключи, которыми нужно открыть двери… «открыть»».
describe('a key ticked «Взял» and the words of each purpose', () => {
  afterEach(() => { localStorage.clear() })

  it('a key not in the stash and ticked «Взял» is «Есть в наличии»', () => {
    const missing: RaidNeedRow = { ...either, key: 'k-missing', alternatives: undefined, stock: 'missing' }
    const view = () => <MemoryRouter><TakenItemsProvider profileId="p1" mode="pvp"><RaidRequirementsPanel rows={[missing]} /></TakenItemsProvider></MemoryRouter>
    const { container, rerender } = render(view())
    expect(container.querySelector('.raid-need')).toHaveTextContent('Нет в наличии')
    act(() => { setItemTaken('p1', 'pvp', 'k219', true) })
    rerender(view())
    expect(container.querySelector('.raid-need')).toHaveTextContent('Есть в наличии')
    expect(container.querySelector('.raid-need')).not.toHaveTextContent('Нет в наличии')
    expect(container.querySelector('.raid-need-stock')?.className).toContain('is-owned')
  })

  it('a door key says «Открыть дверь», a key or an item to plant «Заложить», to mark «Пометить»: no «Взять»', () => {
    const row = (purpose: string): RaidNeedRow => ({ ...either, key: `r-${purpose}`, name: `Предмет ${purpose}`, alternatives: undefined, lines: [{ purpose, questNames: ['Квест'] }] })
    render(<MemoryRouter><RaidRequirementsPanel rows={[row('key'), row('place'), row('mark')]} /></MemoryRouter>)
    expect(screen.getByText('Предмет key').closest('.raid-need')).toHaveTextContent('Открыть дверь · Квест')
    expect(screen.getByText('Предмет place').closest('.raid-need')).toHaveTextContent('Заложить · Квест')
    expect(screen.getByText('Предмет mark').closest('.raid-need')).toHaveTextContent('Пометить · Квест')
    expect(document.body.textContent).not.toMatch(/Взять/)
  })

  it('a quest item the quest finds first says «Поднять и заложить» (report 162)', () => {
    render(<MemoryRouter><RaidRequirementsPanel rows={[{ ...either, key: 'blood', name: 'Проба крови', alternatives: undefined, lines: [{ purpose: 'pickUp', questNames: ['Врачебная тайна. Часть 6'] }] }]} /></MemoryRouter>)
    expect(screen.getByText('Проба крови').closest('.raid-need')).toHaveTextContent('Поднять и заложить · Врачебная тайна. Часть 6')
  })
})

// Owner, 27.11.2026: «Убрать из требований можно только те предметы… которые ты добавил сам… просто убрать из требований рейда кнопку».
describe('an item added by hand', () => {
  it('a right click asks for «Убрать из требований рейда»; an item of a quest does not', () => {
    const onDefer = vi.fn()
    const byHand: RaidNeedRow = { key: 'ms2000', itemId: 'ms2000', name: 'Маркер MS2000', href: '/flea?selected=ms2000', count: 1, lines: [], fromRaidListOnly: true }
    const ofQuest: RaidNeedRow = { ...either, key: 'k-quest', alternatives: undefined, lines: [{ purpose: 'key', questNames: ['Нужно больше энергии'], quests: [{ id: 'q-energy', name: 'Нужно больше энергии', count: 1 }] }] }
    render(<MemoryRouter><RaidRequirementsPanel rows={[byHand, ofQuest]} onDefer={onDefer} /></MemoryRouter>)
    expect(screen.getByText('Маркер MS2000').closest('.raid-need')).toHaveTextContent('Добавлено с барахолки')
    fireEvent.contextMenu(screen.getByText('Маркер MS2000'), { clientX: 10, clientY: 20 })
    expect(onDefer).toHaveBeenLastCalledWith({ x: 10, y: 20, request: { item: { id: 'ms2000', name: 'Маркер MS2000' }, quests: [], addedByHand: true } })
    fireEvent.contextMenu(screen.getByText('Ключ 219'), { clientX: 10, clientY: 20 })
    expect(onDefer).toHaveBeenCalledTimes(2)
    expect(onDefer.mock.lastCall?.[0].request).not.toHaveProperty('addedByHand')
  })
})
