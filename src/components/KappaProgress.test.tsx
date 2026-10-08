import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Quest } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { installCatalogTranslations, setRenderLanguage } from '../i18n/renderText'
import { KappaBreakdownPanel, KappaStatCard } from './KappaProgress'
import type { CollectorTaskRow } from './collectorKeyTasks'

const quest = (id: string, name: string, trader: string): Quest => ({ id, name, trader, level: 1, kappa: false, description: '', objectives: [], rewards: [] })
const rows: CollectorTaskRow[] = [
  { key: 'chemical-part-4', name: 'Реагент. Часть 4', trader: 'Лыжник', state: 'completed', quest: quest('big', 'Большой заказчик', 'Прапор'), alternatives: [quest('big', 'Большой заказчик', 'Прапор'), quest('curious', 'Простое любопытство', 'Терапевт')] },
  { key: 'shooter-born-in-heaven', name: 'Стрелок от бога', trader: 'Механик', state: 'open', quest: quest('sbih', 'Стрелок от бога', 'Механик'), alternatives: [] },
  { key: 'the-tarkov-shooter-part-4', name: 'Тарковский стрелок. Часть 4', trader: 'Егерь', state: 'active', quest: quest('ts4', 'Тарковский стрелок. Часть 4', 'Егерь'), alternatives: [] },
  { key: 'sew-it-good-part-4', name: 'Шить — не тужить. Часть 4', trader: 'Барахольщик', state: 'open', alternatives: [] },
]

function KappaHarness() {
  const [open, setOpen] = useState(false)
  return <LocaleProvider><MemoryRouter>
    <div className="stat-grid"><KappaStatCard completed={1} total={4} open={open} onOpen={() => setOpen(true)} controlsId="kappa-list" /></div>
    <KappaBreakdownPanel id="kappa-list" open={open} rows={rows} completed={1} total={4} onClose={() => setOpen(false)} />
  </MemoryRouter></LocaleProvider>
}

afterEach(() => {
  localStorage.clear()
  installCatalogTranslations([])
  setRenderLanguage('ru')
})

describe('Kappa card', () => {
  it('keeps the card plain and opens the Fence conditions with the four key tasks from «Квесты»', async () => {
    const user = userEvent.setup()
    const { container } = render(<KappaHarness />)
    expect(screen.getByText('Задания для Капы', { selector: '.stat-label' })).toBeInTheDocument()
    expect(screen.getByText('Выполнено 1 из 4', { selector: '.stat-meta' })).toBeInTheDocument()
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
    expect(container.querySelector('#kappa-list')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Закрыть' })).toHaveFocus()

    expect(dialog).toHaveTextContent('Лояльность 4 (корона) у Прапора, Терапевта, Лыжника, Миротворца, Механика, Барахольщика и Егеря')
    expect(dialog).toHaveTextContent('Репутация у Скупщика от +3,0 (карма Дикого)')
    expect(dialog).not.toHaveTextContent('tarkov.dev')
    const tasks = [...dialog.querySelectorAll('.kappa-quest')] as HTMLElement[]
    expect(tasks.map((task) => task.querySelector('strong')?.textContent)).toEqual(['Реагент. Часть 4', 'Стрелок от бога', 'Тарковский стрелок. Часть 4', 'Шить — не тужить. Часть 4'])
    expect(tasks.map((task) => task.querySelector('.kappa-quest-state')?.textContent)).toEqual(['выполнено', 'не выполнено', 'текущее', 'не выполнено'])
    expect(tasks[0]).toHaveTextContent('Лыжник · или «Большой заказчик» (Прапор), «Простое любопытство» (Терапевт)')
    expect(tasks[0]).toHaveAttribute('href', '/quests?selected=big')
    expect(tasks[3].tagName).toBe('DIV')

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
    installCatalogTranslations([['Большой заказчик', 'Big Customer']])
    const user = userEvent.setup()
    render(<KappaHarness />)
    expect(screen.getByText('Kappa-required tasks', { selector: '.stat-label' })).toBeInTheDocument()
    expect(screen.getByText('Completed 1 of 4', { selector: '.stat-meta' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tasks' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Fence gives out “The Collector” once three conditions are met:')
    expect(dialog).toHaveTextContent('Fence reputation +3.0 or higher (Scav karma)')
    expect(dialog).toHaveTextContent('Chemical - Part 4')
    expect(dialog).toHaveTextContent('Sew it Good - Part 4')
    expect(dialog).toHaveTextContent('“Big Customer”')
    expect(within(dialog).getAllByText('not done')).toHaveLength(2)
  })
})
