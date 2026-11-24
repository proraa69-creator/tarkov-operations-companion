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
import type { LivePrices } from '../data/livePrices'

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

const flat = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ') ?? ''

function renderFlea(path: string, live?: LivePrices) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  if (live) client.setQueryData(['live-prices', 'pvp'], live)
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

  // Owner, 09.11.2026: «написано цена обновилась 2 минуты назад, смотрю цену а она очень сильно другая».
  it('shows the minute price in place of the catalog one, with how old that price is', () => {
    const minute = Math.floor(Date.now() / 60_000)
    const pricesAt = (minute - 4) * 60_000
    const live: LivePrices = { updatedAt: Date.now(), pricesAt, items: new Map([['intel', { lastLowPrice: 90000, avg24hPrice: 95000, at: minute - 93 }]]) }
    const { container } = renderFlea('/flea?selected=intel', live)
    const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ') ?? ''
    const row = text(container.querySelector('.price-table tbody tr'))
    expect(row).toMatch(/90 000 ₽/)
    expect(row).not.toMatch(/130 000/)
    expect(text(container.querySelector('.flea-price-age'))).toBe('1 ч 33 мин назад')
    const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(pricesAt)
    expect(text(container.querySelector('.page-header .tag'))).toContain(`последнее обновление цен: ${clock}`)
    expect(text(container.querySelector('.flea-detail .price-table tbody tr'))).toContain('минимальное предложение · 1 ч 33 мин назад')
  })

  it('a lone expensive listing gives the average of the day and no age; a price without its own time gives no age either', () => {
    const minute = Math.floor(Date.now() / 60_000)
    const lone = renderFlea('/flea', { items: new Map([['intel', { lastLowPrice: 700000, avg24hPrice: 137350, at: minute - 2 }]]) })
    expect(flat(lone.container.querySelector('.price-table tbody tr'))).toMatch(/137 350 ₽/)
    expect(lone.container.querySelector('.flea-price-age')).toBeNull()
    lone.unmount()
    const timeless = renderFlea('/flea', { updatedAt: Date.now(), items: new Map([['intel', { lastLowPrice: 90000 }]]) })
    expect(flat(timeless.container.querySelector('.price-table tbody tr'))).toMatch(/90 000 ₽/)
    expect(timeless.container.querySelector('.flea-price-age')).toBeNull()
  })

  it('without minute prices the catalog price stands and the tag stays as it was', () => {
    const { container } = renderFlea('/flea')
    expect(flat(container.querySelector('.price-table tbody tr'))).toMatch(/130 000 ₽/)
    expect(container.querySelector('.flea-price-age')).toBeNull()
    expect(container.querySelector('.page-header .tag')?.textContent).toContain('обновлено')
  })
})
