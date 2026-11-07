import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'

const round = (id: string, shortName: string, damage: number, penetration: number) => ({ id, shortName, name: `${shortName} name`, caliber: 'Caliber556x45NATO', damage, penetration, projectileCount: 1 })
const ROUNDS = [round('a', 'M855', 54, 31), round('b', 'M995', 42, 53), round('c', 'RRLP', 70, 12)]

vi.mock('../data/DataProvider', () => ({
  useTarkovData: () => ({ source: 'live', data: { traders: [], quests: [], maps: [], items: [] } }),
  useTarkovDataStatus: () => ({ updatedAt: '2026-11-06T00:00:00.000Z' }),
  useOptionalTarkovData: () => null,
}))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp' }), useOptionalAppState: () => ({ raidMode: 'pvp' }) }))
vi.mock('../restock/RestockWidgets', () => ({ TraderRestockTimer: () => null, RestockSettingsPanel: () => null }))
vi.mock('../components/SupportButtons', () => ({ REWARD_NOTE: '', SupportButtons: () => null }))
vi.mock('../arsenal/ammoSource', async (original) => {
  const actual = await original<typeof import('../arsenal/ammoSource')>()
  return { ...actual, useAmmoStats: () => ({ data: ROUNDS, isLoading: false }), withModePrices: (rows: unknown) => rows }
})
vi.mock('../arsenal/BallisticsCharts', () => ({
  AmmoScatter: () => <div data-testid="scatter" />,
  CaliberLegend: () => null,
  ArmorEffectivenessTable: ({ ammo }: { ammo: { shortName: string } }) => <div data-testid="armor">{ammo.shortName}</div>,
}))
vi.mock('../arsenal/BulletDrop', () => ({ BulletDropPanel: () => <div data-testid="drop" /> }))

const { AmmoPage } = await import('./ReferencePages')
const renderPage = (path = '/ballistics') => render(<LocaleProvider><MemoryRouter initialEntries={[path]}><AmmoPage /></MemoryRouter></LocaleProvider>)
const tab = (name: string) => screen.getByRole('tab', { name })
const firstRounds = () => [...document.querySelectorAll('.ammo-table tbody tr strong:first-child')].map((cell) => cell.textContent).filter((text) => /^[A-Z]/.test(text ?? ''))

describe('«Баллистика» by tabs (owner, 06.11.2026: «переключаться между таблицами», не листать одну страницу)', () => {
  it('four buttons in the owner\'s order, «Пробитие и урон» first, «Список патронов» on the right, one table at a time', () => {
    renderPage()
    expect(screen.getAllByRole('tab').map((entry) => entry.textContent)).toEqual(['Пробитие и урон', 'Падение пули', 'Пробитие брони', 'Список патронов'])
    expect(tab('Пробитие и урон')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('scatter')).toBeInTheDocument()
    for (const other of ['drop', 'armor']) expect(screen.queryByTestId(other)).toBeNull()
    expect(document.querySelector('.ammo-table')).toBeNull()
    fireEvent.click(tab('Падение пули'))
    expect(screen.getByTestId('drop')).toBeInTheDocument()
    expect(screen.queryByTestId('scatter')).toBeNull()
  })

  it('«Список патронов» is the table, with its order by penetration, damage and balance; elsewhere those buttons are not drawn', () => {
    renderPage()
    expect(document.querySelector('.ammo-order')).toBeNull()
    fireEvent.click(tab('Список патронов'))
    const order = within(document.querySelector('.ammo-order') as HTMLElement)
    expect(order.getAllByRole('button').map((entry) => entry.textContent)).toEqual(['Пробитие', 'Урон', 'Баланс'])
    expect(firstRounds()).toEqual(['M995', 'M855', 'RRLP'])
    fireEvent.click(order.getByRole('button', { name: 'Урон' }))
    expect(firstRounds()).toEqual(['RRLP', 'M855', 'M995'])
    fireEvent.click(order.getByRole('button', { name: 'Баланс' }))
    expect(firstRounds()).toEqual(['M995', 'M855', 'RRLP'])
  })

  it('«Пробитие брони» picks its round right there, and the round chosen in the list stands in it, whatever the order', () => {
    renderPage('/ballistics?tab=armor')
    expect(screen.getByTestId('armor').textContent).toBe('M995')
    fireEvent.change(screen.getByRole('combobox', { name: 'Патрон' }), { target: { value: 'a' } })
    expect(screen.getByTestId('armor').textContent).toBe('M855')
    fireEvent.click(tab('Список патронов'))
    fireEvent.click(screen.getByText('RRLP'))
    fireEvent.click(within(document.querySelector('.ammo-order') as HTMLElement).getByRole('button', { name: 'Урон' }))
    fireEvent.click(tab('Пробитие брони'))
    expect(screen.getByTestId('armor').textContent).toBe('RRLP')
  })
})
