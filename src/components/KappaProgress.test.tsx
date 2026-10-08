import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Quest } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { installCatalogTranslations, setRenderLanguage } from '../i18n/renderText'
import { KappaBreakdownPanel, KappaStatCard } from './KappaProgress'
import type { KappaQuestRow } from './kappaBreakdown'

const quest = (id: string, name: string, level: number): Quest => ({ id, name, trader: 'Прапор', level, kappa: true, description: '', objectives: [], rewards: [] })
const ratHunt = quest('rat-hunt', 'Охота на крыс', 9)
const rows: KappaQuestRow[] = [
  { quest: quest('shortage', 'Дефицит', 3), status: 'completed', counted: true, source: 'eft-log' },
  { quest: quest('scanned', 'Секта', 14), status: 'completed', counted: true, source: 'screen-scan' },
  { quest: quest('manual', 'Ищейка', 18), status: 'completed', counted: true, source: 'manual' },
  { quest: quest('debut', 'Дебют', 1), status: 'completed', counted: true, source: 'inferred', via: ratHunt, viaStatus: 'active' },
  { quest: quest('sanitary', 'Санитарные нормы', 9), status: 'available', counted: false },
  { quest: quest('failed', 'Ловушка', 20), status: 'failed', counted: false },
]

function KappaHarness() {
  const [open, setOpen] = useState(false)
  return <LocaleProvider><MemoryRouter>
    <div className="stat-grid"><KappaStatCard completed={4} total={6} open={open} onOpen={() => setOpen(true)} controlsId="kappa-list" /></div>
    <KappaBreakdownPanel id="kappa-list" open={open} rows={rows} completed={4} total={6} onClose={() => setOpen(false)} />
  </MemoryRouter></LocaleProvider>
}

afterEach(() => {
  localStorage.clear()
  installCatalogTranslations([])
  setRenderLanguage('ru')
})

describe('Kappa card', () => {
  it('keeps the card plain and opens the counted tasks with their sources from «Квесты»', async () => {
    const user = userEvent.setup()
    const { container } = render(<KappaHarness />)
    expect(screen.getByText('Задания для Капы', { selector: '.stat-label' })).toBeInTheDocument()
    expect(screen.getByText('Выполнено 4 из 6', { selector: '.stat-meta' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Предметы' })).toHaveAttribute('href', '/kappa-items')
    const quests = screen.getByRole('button', { name: 'Квесты' })
    expect(quests).toHaveAttribute('aria-haspopup', 'dialog')
    expect(quests).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(quests)
    const dialog = screen.getByRole('dialog', { name: 'Задания для Капы' })
    expect(quests).toHaveAttribute('aria-expanded', 'true')
    expect(quests).toHaveAttribute('aria-controls', 'kappa-list')
    expect(dialog).toHaveAttribute('id', 'kappa-list')
    // the dialog sits over the page: the card grid keeps its layout
    expect(container.querySelector('#kappa-list')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Закрыть' })).toHaveFocus()

    const counted = dialog.querySelectorAll('.kappa-breakdown-grid')[0] as HTMLElement
    const entries = within(counted).getAllByRole('link')
    expect(entries.map((entry) => entry.querySelector('strong')?.textContent)).toEqual(['Дефицит', 'Секта', 'Ищейка', 'Дебют'])
    expect(entries.map((entry) => entry.querySelector('.kappa-quest-state')?.textContent)).toEqual(['по логам', 'по экрану', 'вручную', 'по цепочке'])
    expect(entries[3]).toHaveTextContent('взято «Охота на крыс»')
    expect(entries[0]).toHaveAttribute('href', '/quests?filter=kappa&selected=shortage')
    expect(within(dialog).getByText('Засчитаны · 4')).toBeInTheDocument()
    expect(within(dialog).getByText('Не выполнены · 2')).toBeInTheDocument()
    expect(within(dialog).getByText('провалено')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(quests).toHaveAttribute('aria-expanded', 'false')
    expect(quests).toHaveFocus()
  })

  it('closes on Esc and on a click outside the list', async () => {
    const user = userEvent.setup()
    render(<KappaHarness />)
    await user.click(screen.getByRole('button', { name: 'Квесты' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Квесты' }))
    await user.pointer({ keys: '[MouseLeft]', target: document.querySelector('.kappa-breakdown-overlay')! })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('speaks English', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    // the English catalog names quests in English; here its translation table stands in for it
    installCatalogTranslations([['Охота на крыс', 'Rat hunt']])
    const user = userEvent.setup()
    render(<KappaHarness />)
    expect(screen.getByText('Kappa-required tasks', { selector: '.stat-label' })).toBeInTheDocument()
    expect(screen.getByText('Completed 4 of 6', { selector: '.stat-meta' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(screen.getByText('from logs')).toBeInTheDocument()
    expect(screen.getByText('from screen')).toBeInTheDocument()
    expect(screen.getByText('manual')).toBeInTheDocument()
    expect(screen.getByText('by chain')).toBeInTheDocument()
    expect(screen.getByText(/accepted “Rat hunt”/)).toBeInTheDocument()
    expect(screen.getByText(/tasks tarkov\.dev marks as required for Kappa/)).toBeInTheDocument()
  })
})
