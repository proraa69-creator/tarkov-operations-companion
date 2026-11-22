import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Item, Quest, Trader } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { ItemQuestUnlocks, QuestOfferUnlocks } from './QuestOfferUnlocks'

const prapor = { id: 'prapor-id', name: 'Прапор', normalizedName: 'prapor' } as Trader
const skier = { id: 'skier-id', name: 'Лыжник', normalizedName: 'skier' } as Trader
const items = [
  { id: 'ammo-bt', name: '9x21мм БТ гж', shortName: 'БТ', category: 'Боеприпас', types: ['ammo', 'noFlea'], description: '', prices: [], iconUrl: 'bt.webp' },
  { id: 'drum', name: 'Магазин барабанный Молот', shortName: 'Молот', category: 'Бартер', types: ['mods'], description: '', prices: [] },
  { id: 'afak', name: 'Аптечка AFAK', shortName: 'AFAK', category: 'Медицина', types: ['meds'], description: '', prices: [] },
] as Item[]
const quest = {
  id: 'q-oil', name: 'Нефтянка', trader: 'Прапор', level: 10, kappa: false, description: '', objectives: [], rewards: [],
  offerUnlocks: [{ itemId: 'ammo-bt', traderId: 'prapor-id', level: 3 }, { itemId: 'drum', traderId: 'prapor-id', level: 3 }, { itemId: 'afak', traderId: 'skier-id', level: 4, barter: true }],
} as Quest
const other = { ...quest, id: 'q-other', name: 'Другой квест', offerUnlocks: [{ itemId: 'ammo-bt', traderId: 'skier-id', level: 2 }] } as Quest
const progress = { taskProgress: { 'q-oil': { status: 'completed' } } }

vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { quests: [quest, other], items, traders: [prapor, skier] } }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp', activeProfile: { modes: { pvp: progress } } }) }))

const show = (node: React.ReactNode, locale: 'ru' | 'en' = 'ru') => {
  localStorage.setItem('tarkov-operations-locale-v1', locale)
  return render(<LocaleProvider><MemoryRouter>{node}</MemoryRouter></LocaleProvider>)
}

afterEach(() => { cleanup(); localStorage.clear() })

describe('what a quest opens at the traders (report 171)', () => {
  it('lists parts, ammo and other items in the rewards, each opening its card on «Барахолка»', () => {
    show(<QuestOfferUnlocks quest={quest} />)
    const block = screen.getByTestId('quest-offer-unlocks')
    expect(block.textContent).toContain('Открывает у торговцев')
    expect([...block.querySelectorAll('.quest-unlocks-kind')].map((node) => node.textContent)).toEqual(['Модули', 'Патроны', 'Предметы'])
    expect(within(block).getByRole('link', { name: /Молот/ })).toHaveAttribute('href', '/flea?selected=drum')
    expect(within(block).getByRole('link', { name: /БТ/ }).textContent).toContain('Прапор, ур. 3')
    expect(within(block).getByRole('link', { name: /AFAK/ }).textContent).toContain('Лыжник, ур. 4 · бартер')
  })

  it('says it in English', () => {
    show(<QuestOfferUnlocks quest={quest} />, 'en')
    const block = screen.getByTestId('quest-offer-unlocks')
    expect(block.textContent).toContain('Unlocks at traders')
    expect(block.textContent).toContain('LL3')
    expect(block.textContent).toContain('barter')
  })

  it('shows nothing for a quest that opens nothing', () => {
    const { container } = show(<QuestOfferUnlocks quest={{ ...quest, offerUnlocks: undefined }} />)
    expect(container.textContent).toBe('')
  })

  it('names the quests that open an item in its card; the name opens the quest in «Квесты»', () => {
    show(<ItemQuestUnlocks itemId="ammo-bt" />)
    const block = screen.getByTestId('item-quest-unlocks')
    expect(block.textContent).toContain('Открывается после квестов')
    const links = within(block).getAllByRole('link')
    // The lowest loyalty first; a done quest is marked.
    expect(links.map((link) => link.textContent)).toEqual(['«Другой квест»', '«Нефтянка»'])
    expect(links[1]).toHaveAttribute('href', '/quests?selected=q-oil&find=1')
    expect(block.querySelectorAll('.item-quest-done')).toHaveLength(1)
  })

  it('has no block for an item no quest opens', () => {
    const { container } = show(<ItemQuestUnlocks itemId="unknown" />)
    expect(container.textContent).toBe('')
  })
})
