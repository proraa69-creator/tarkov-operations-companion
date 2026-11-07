import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Barter } from '../data/economyApi'
import type { Item } from '../domain/types'
import { QuestKeyBarterDialog, QuestKeyMarket } from './QuestKeyMarket'

// Owner, 07.11.2026: «слева от нее будет писаться цена, актуальная… написано, когда последний раз обновлено… ниже под ней пишется
// бартер. По нажатию открывается окно бартера. У какого торговца и на что можно менять… с какого уровня лояльности».
const key: Item = {
  id: 'kpp', name: 'Ключ от военного КПП', shortName: 'КПП', category: 'Ключ', iconUrl: '/kpp.webp',
  prices: [{ source: 'Барахолка', kind: 'flea', mode: 'pvp', price: 288_888, updatedAt: new Date(Date.now() - 10 * 60_000).toISOString() }],
} as Item
const barter: Barter = {
  id: 'b1', traderId: 'jaeger', traderName: 'Егерь', level: 2, requiredItems: [{ itemId: 'docs', count: 2 }, { itemId: 'vodka', count: 4 }], rewardItems: [{ itemId: 'kpp', count: 1 }],
}

describe('a quest key\'s price and barter', () => {
  it('shows the flea price with when it was renewed, and «Бартер» when a trader gives it', () => {
    const onBarter = vi.fn()
    render(<QuestKeyMarket item={key} mode="pvp" barters={[barter]} onBarter={onBarter} />)
    expect(screen.getByText('288 888 ₽')).toBeTruthy()
    expect(screen.getByText(/10 мин назад/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Бартер/ }))
    expect(onBarter).toHaveBeenCalled()
  })

  it('says when a key is not on the flea market, and has no «Бартер» without barters', () => {
    render(<QuestKeyMarket item={{ ...key, prices: [] }} mode="pvp" barters={[]} onBarter={() => {}} />)
    expect(screen.getByText('Нет на барахолке')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Бартер/ })).toBeNull()
  })

  it('the barter window: the trader, the loyalty level that opens it, what to give', () => {
    const names: Record<string, string> = { docs: 'Техническая документация', vodka: 'Бутылка водки «Тарковская»' }
    render(<QuestKeyBarterDialog item={key} barters={[barter]} loyalty={new Map([['jaeger', 1]])} onClose={() => {}}
      partOf={(itemId, count) => ({ id: itemId, name: names[itemId] ?? itemId, count })} traderOf={() => undefined} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Егерь')
    expect(dialog.textContent).toContain('Уровень лояльности 2')
    expect(dialog.textContent).toContain('у вас 1')
    expect(dialog.textContent).toContain('Техническая документация×2')
    expect(dialog.textContent).toContain('Бутылка водки «Тарковская»×4')
  })
})
