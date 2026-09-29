import { describe, expect, it } from 'vitest'
import type { Item, Quest } from '../domain/types'
import { createItemMatcher, createTooltipMatcher } from './itemMatch'
import { describeItem } from './itemInfo'

const item = (id: string, name: string, shortName: string, fleaPrice?: number): Item => ({
  id, name, shortName, category: 'Бартер', description: '', fleaPrice,
  prices: [{ source: 'Барахолка', price: fleaPrice ?? 0, mode: 'pvp', updatedAt: '' }, { source: 'Терапевт', price: 21000, mode: 'pvp', updatedAt: '' }],
})

const ITEMS = [
  item('flash', 'Флешка с зашифрованными данными', 'Флешка'),
  item('ledx', 'Трансиллюминатор кожи LEDX', 'LEDX', 900000),
  item('tetriz', 'Портативная игра Tetriz', 'Tetriz', 45000),
  item('bolts', 'Болты', 'Болты', 12000),
]

describe('item lookup under the cursor', () => {
  const match = createItemMatcher(ITEMS)

  it('finds the item from a noisy tooltip line', () => {
    expect(match('| Трансиллюминатор кожи LEDХ ~\nНайдено в рейде')?.id).toBe('ledx')
    expect(match('ffl Портативная игра Tetrlz')?.id).toBe('tetriz')
  })

  it('accepts a short name only as a whole word', () => {
    expect(match('Tetriz')?.id).toBe('tetriz')
    expect(match('Болтовня')).toBeNull()
  })

  it('returns nothing for unrelated text', () => {
    expect(match('ИНВЕНТАРЬ\nСНАРЯЖЕНИЕ')).toBeNull()
  })

  it('lists open quests, Kappa and prices for the item', () => {
    const quests = [
      { id: 'q1', name: 'Коллекционер', trader: 'Смотритель', level: 1, kappa: true, description: '', objectives: [], rewards: [], raidRequirements: [{ itemId: 'tetriz', count: 1, purpose: 'handover' as const, mapIds: [] }] },
      { id: 'q2', name: 'Гонки', trader: 'Механик', level: 10, kappa: false, description: '', objectives: [], rewards: [], raidRequirements: [{ itemId: 'tetriz', count: 2, purpose: 'find' as const, mapIds: [] }] },
      { id: 'q3', name: 'Сделано', trader: 'Прапор', level: 5, kappa: false, description: '', objectives: [], rewards: [], requiredItems: ['tetriz'] },
    ] satisfies Quest[]
    const info = describeItem(ITEMS[2]!, quests, { taskProgress: { q3: { taskId: 'q3', status: 'completed', source: 'manual', updatedAt: '' } } })
    expect(info.quests.map((need) => [need.name, need.count, need.purpose])).toEqual([['Коллекционер', 1, 'сдать'], ['Гонки', 2, 'найти']])
    expect(info.kappa).toBe(true)
    expect(info.collector).toBe(true)
    expect(info.fleaPrice).toBe(45000)
    expect(info.bestTrader).toEqual({ name: 'Терапевт', price: 21000 })
  })
})

describe('matchNearest', () => {
  it('prefers the line nearest to the cursor over other labels on screen', async () => {
    const { matchNearest } = await import('./itemMatch')
    const names: Record<string, string> = { 'бинт': 'bandage', 'коллиматорный прицел burris fastfire 3': 'ff3' }
    const match = (text: string) => { const id = names[text.toLowerCase()]; return id ? ({ id } as never) : null }
    const lines = [{ text: 'Бинт', distance: 70 }, { text: 'Коллиматорный прицел Burris', distance: 22 }, { text: 'FastFire 3', distance: 40 }]
    expect((matchNearest(match, lines) as { id: string } | null)?.id).toBe('ff3')
  })
})

describe('item from the game tooltip', () => {
  const items = [
    { id: 'a', name: 'Шоколад "Аленка"', shortName: 'Аленка' },
    { id: 'b', name: 'Набор медикаментов', shortName: 'Мед.' },
    { id: 'c', name: 'Патрон 12/70 "Пиранья"', shortName: 'Пиранья' },
    { id: 'd', name: 'Патрон 12/70 "Флешетта"', shortName: 'Флешетта' },
  ] as unknown as Parameters<typeof createTooltipMatcher>[0]
  const match = createTooltipMatcher(items)

  it('matches the whole name the tooltip shows, despite OCR slips', () => {
    expect(match('Шоколад "Аленка"')?.id).toBe('a')
    expect(match('Шоколaд «Алeнкa»')?.id).toBe('a')
    expect(match('Патрон 12/70 Пиранья')?.id).toBe('c')
    expect(match('| Набор медикаментов')?.id).toBe('b')
  })

  it('answers nothing rather than a wrong item', () => {
    expect(match('Рюкзак')).toBeNull()
    expect(match('Патрон')).toBeNull()
  })
})
