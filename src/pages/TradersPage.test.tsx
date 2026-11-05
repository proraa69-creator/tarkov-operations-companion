import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Trader } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { TradersPage } from './ReferencePages'

const trader = (id: string, name: string): Trader => ({ id, name, normalizedName: id, role: '', loyalty: 4, accent: '#888', levelPlayerLevels: [1, 12, 26, 40] })
const traders = [trader('prapor', 'Прапор'), trader('therapist', 'Терапевт'), trader('skier', 'Лыжник'), trader('mechanic', 'Механик'), { ...trader('lightkeeper', 'Смотритель'), loyalty: 1, levelPlayerLevels: [1] }]
const levels: Array<[number, number, number?]> = [[0, 1], [1, 2], [2, 3], [3, 4, 4]]
const infos = levels.map(([at, level, manual]) => ({ trader: traders[at], key: traders[at].id, min: 1, max: 4, level, ...(manual ? { manual } : {}) }))

const setLevel = vi.hoisted(() => vi.fn())
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { traders, quests: [], maps: [], items: [] } }) }))
vi.mock('../gunsmith/useGunsmithAccess', () => ({ useGunsmithAccess: () => ({ infos, setLevel }) }))
vi.mock('../components/TraderFigure', () => ({ TraderFigure: () => null }))
vi.mock('../components/TraderQuestBoard', () => ({ TraderQuestBoard: () => null }))
vi.mock('../restock/RestockWidgets', () => ({ TraderRestockTimer: () => <small className="restock-timer">ресток через 1:00</small>, RestockSettingsPanel: () => null }))

const renderPage = () => render(<LocaleProvider><MemoryRouter><TradersPage /></MemoryRouter></LocaleProvider>)
const card = (name: string) => screen.getByRole('button', { name })
const badge = (name: string) => screen.queryByRole('button', { name: `Изменить уровень лояльности: ${name}` })

beforeEach(() => setLevel.mockClear())

describe('«Торговцы»: the cards', () => {
  // Owner, 04.11.2026: «Римскими цифрами 1, 2, 3. И четвертая – это корона».
  it('show each trader\'s loyalty as in the game; a trader without levels has none', () => {
    renderPage()
    expect(badge('Прапор')).toHaveTextContent(/^I$/)
    expect(badge('Терапевт')).toHaveTextContent(/^II$/)
    expect(badge('Лыжник')).toHaveTextContent(/^III$/)
    expect(within(badge('Механик')!).getByLabelText('IV')).toBeInTheDocument()
    expect(badge('Смотритель')).toBeNull()
  })

  // Owner, 04.11.2026: «Рамка очень большая, перекрывает полкартинки».
  it('carry the name and the restock on the picture, not in a strip of their own', () => {
    renderPage()
    const caption = card('Прапор').querySelector('.trader-caption') as HTMLElement
    expect(caption).toHaveTextContent('Прапор')
    expect(caption.querySelector('.restock-timer')).not.toBeNull()
    expect(card('Прапор').querySelector('.trader-portrait')?.getAttribute('style')).toBeNull()
  })

  // Owner, 04.11.2026: «уровни лояльности торговцев менялись вручную по нажатию на каждый значок».
  it('a click on the badge offers the levels and sets the chosen one, without opening the trader', () => {
    renderPage()
    expect(card('Терапевт')).toHaveAttribute('aria-pressed', 'false')
    expect(card('Терапевт').contains(badge('Терапевт'))).toBe(false)
    fireEvent.click(badge('Терапевт')!)
    expect(card('Терапевт')).toHaveAttribute('aria-pressed', 'false')
    const menu = screen.getByRole('radiogroup', { name: 'Терапевт' })
    expect(within(menu).getAllByRole('radio')).toHaveLength(4)
    expect(within(menu).getByRole('radio', { name: 'II' })).toBeChecked()
    fireEvent.click(within(menu).getByRole('radio', { name: 'III' }))
    expect(setLevel).toHaveBeenCalledWith('therapist', 3)
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('«из игры» gives a level set by hand back; a level the app found has nothing to give back', () => {
    renderPage()
    fireEvent.click(badge('Прапор')!)
    expect(screen.queryByRole('button', { name: 'из игры' })).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(badge('Механик')).toHaveClass('is-manual')
    fireEvent.click(badge('Механик')!)
    fireEvent.click(screen.getByRole('button', { name: 'из игры' }))
    expect(setLevel).toHaveBeenCalledWith('mechanic', null)
  })
})
