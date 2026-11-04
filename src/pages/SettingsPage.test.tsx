import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'

vi.mock('../data/DataProvider', () => ({
  useTarkovData: () => ({ source: 'live', data: { traders: [], quests: [], maps: [], items: [] } }),
  useTarkovDataStatus: () => ({ updatedAt: '2026-11-04T00:00:00.000Z' }),
  useOptionalTarkovData: () => null,
}))
vi.mock('../restock/RestockWidgets', () => ({ TraderRestockTimer: () => null, RestockSettingsPanel: () => <p>ресток</p> }))
vi.mock('../components/AppUpdateSettings', () => ({ AppUpdateSettings: () => <p>обновление</p> }))
vi.mock('../components/SupportButtons', () => ({ REWARD_NOTE: '', SupportButtons: () => null }))
vi.mock('../components/DonateCard', () => ({ DonateCard: () => null }))
vi.mock('../components/ClickVolumeSetting', () => ({ ClickVolumeSetting: () => null }))
vi.mock('../onboarding/GuideReplaySetting', () => ({ GuideReplaySetting: () => null }))
vi.mock('../announcement/features', () => ({ useRemoteFeatures: () => ({ positionTracking: true }) }))

const { SettingsPage } = await import('./ReferencePages')

const renderPage = () => render(<LocaleProvider><MemoryRouter><SettingsPage /></MemoryRouter></LocaleProvider>)
const titles = (column: Element) => [...column.querySelectorAll('.panel-title')].map((title) => title.textContent)

afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop') })

describe('«Настройки»: the panels', () => {
  // Owner, 04.11.2026: «Почему этот блок стоит где-то снизу посередине сдвинь его выше… ресток перенеси в правую колонку выше. Под блок данных».
  it('the PC app: two columns of their own, «Поддержка», «Данные», «Ресток торговцев» one under the other on the right', async () => {
    const pending = () => new Promise(() => {})
    Object.assign(window, { tarkovDesktop: { experimental: { getSettings: pending, getStatus: pending } } })
    renderPage()
    expect(await screen.findByText('Ресток торговцев')).toBeInTheDocument()
    const columns = document.querySelectorAll('.raid-tools .settings-grid > .raid-tools-stack')
    expect(columns).toHaveLength(2)
    expect(titles(columns[0]!).at(-1)).toBe('Интерфейс')
    expect(titles(columns[1]!)).toEqual(['Поддержка', 'Данные', 'Ресток торговцев'])
    // Nothing is left for a second grid under them, whose rows made the gap.
    expect(document.querySelectorAll('.settings-grid')).toHaveLength(1)
  })

  it('the site and the phone: one grid of the same panels', () => {
    renderPage()
    const grid = document.querySelector('.settings-grid')!
    expect(titles(grid)).toEqual(['Интерфейс', 'Поддержка', 'Данные', 'Ресток торговцев'])
    expect(document.querySelector('.raid-tools')).toBeNull()
  })
})
