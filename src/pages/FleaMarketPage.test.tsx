import { beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppDataset, Item } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { AppStateProvider } from '../state/AppState'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { fleaMarketFee } from '../domain/fleaFee'
import { FleaMarketPage } from './FleaMarketPage'

/** A PvP catalog item: lowest offer 130 000 ₽ (24-hour average was higher), a trader paying 125 000 ₽. */
const intel: Item = {
  id: 'intel', name: 'Папка с разведданными', shortName: 'Intel', category: 'Бартер', description: '', basePrice: 100000, fleaPrice: 130000, fleaPriceBasis: 'last-low',
  prices: [
    { source: 'Барахолка', price: 130000, mode: 'pvp', updatedAt: '', kind: 'flea', basis: 'last-low' },
    { source: 'Механик', price: 125000, mode: 'pvp', updatedAt: '', kind: 'trader' },
    // A PvE quote in the same list must never show in PvP.
    { source: 'Барахолка', price: 990000, mode: 'pve', updatedAt: '', kind: 'flea' },
  ],
}
const dataset: AppDataset = {
  ...demoDataset,
  items: [intel],
  metadata: { source: 'json.tarkov.dev', mode: 'pvp', loadedAt: '2026-10-08T00:00:00.000Z', counts: {}, fleaMarket: { enabled: true, offerFeeRate: 0.03, requirementFeeRate: 0.03 } },
}

function renderFlea(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={[path]}><FleaMarketPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('FleaMarketPage prices', () => {
  it('lists the PvP flea price (cheapest offer) and marks the trader «лучшее» when the flea after the fee keeps less', () => {
    const { container } = renderFlea('/flea?selected=intel')
    const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ') ?? ''
    const row = text(container.querySelector('.price-table tbody tr'))
    expect(row).toMatch(/130 000 ₽/)
    expect(row).not.toMatch(/990 000/)
    const detail = [...container.querySelectorAll('.flea-detail .price-table tbody tr')].map(text)
    const net = (130000 - fleaMarketFee(100000, 130000)).toLocaleString('ru-RU').replace(/\s/g, ' ')
    expect(detail).toHaveLength(2)
    expect(detail[0]).toContain('минимальное предложение')
    expect(detail[0]).toContain(`после комиссии ${net} ₽`)
    expect(detail[0]).not.toContain('лучшее')
    expect(detail[1]).toContain('Механик')
    expect(detail[1]).toContain('лучшее')
  })
})
