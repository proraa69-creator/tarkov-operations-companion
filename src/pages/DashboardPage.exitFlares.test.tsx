import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppDataset, Item, Quest, RaidMode } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { AppStateProvider } from '../state/AppState'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { deferQuest } from '../progression/deferredQuests'
import { DashboardPage } from './DashboardPage'

// Owner, 19.11.2026: the flare an exit needs in «Требования рейда», a line of its own; none while «Прекратить огонь!» is current; the
// pistol, the cartridge and the calibre in a flare's hover card.
const RSP_GREEN = '6217726288ed9f0845317459'
const GREEN = '62389aaba63f32501b1b444f'
const RED = '62389ba9a63f32501b1b4451'
const PISTOL = '620109578d82e67e7911abf2'
const item = (id: string, name: string, types: string[], caliber?: string): Item => ({ id, name, shortName: name, category: 'Бартер', description: '', types, prices: [], ...(caliber ? { caliber } : {}) })
const task = (id: string, name: string, raidRequirements: Quest['raidRequirements'], objectiveDetails: Quest['objectiveDetails']): Quest => ({
  id, name, trader: 'Егерь', mapId: 'customs', mapIds: ['customs'], level: 10, kappa: false, description: '', objectives: [], rewards: [], raidRequirements, objectiveDetails,
})
const greenFlares = (objectiveId: string) => [RSP_GREEN, GREEN].map((itemId) => ({ itemId, count: 1, purpose: 'signal' as const, mapIds: ['customs'], objectiveId, alternatives: 2 }))
const ceasefire = task('ceasefire', 'Прекратить огонь!', greenFlares('cf-exit'), [{ id: 'cf-exit', type: 'extract', description: 'Выйти через ЖД проход', count: 1, mapIds: ['customs'] }])
const redSignal = task('red-signal', 'Сигнал у ворот', [{ itemId: RED, count: 1, purpose: 'signal', mapIds: ['customs'], objectiveId: 'rs-use' }], [{ id: 'rs-use', type: 'useItem', description: 'Подать красный сигнал', count: 1, mapIds: ['customs'] }])
const greenSignal = task('green-signal', 'Зелёный сигнал', greenFlares('gs-use'), [{ id: 'gs-use', type: 'useItem', description: 'Подать зелёный сигнал', count: 1, mapIds: ['customs'] }])

const data: AppDataset = {
  ...demoDataset,
  quests: [...demoDataset.quests, ceasefire, redSignal, greenSignal],
  items: [
    ...demoDataset.items,
    item(RSP_GREEN, 'Реактивный сигнальный патрон РСП-30 (Зеленый)', ['gun', 'specialSlot'], 'Caliber26x75'),
    item(GREEN, '26x75 сигнальный патрон (Зеленый)', ['ammo'], 'Caliber26x75'),
    item(RED, '26x75 сигнальный патрон (Красный)', ['ammo'], 'Caliber26x75'),
    item(PISTOL, 'Сигнальный пистолет ЗиД СП-81 26x75', ['gun'], 'Caliber26x75'),
  ],
  markers: [
    ...demoDataset.markers,
    { id: 'customs-extract-rail', mapId: 'customs', type: 'extract', layerId: 'extract.pmc', extractFaction: 'pmc', extractId: 'rail', title: 'Проход через ЖД пути (Сигнал)', description: '', position: [300, 300] },
  ],
}

function renderOverview(tasks: string[], deferred: Partial<Record<RaidMode, string[]>> = {}) {
  let profile = createLocalProfile('TEST', 'overview')
  for (const taskId of tasks) profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-11-19T10:00:00.000Z' })
  for (const [mode, ids] of Object.entries(deferred) as Array<[RaidMode, string[]]>) for (const id of ids) deferQuest(profile.id, mode, id)
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], data)
  const view = render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter><DashboardPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
  const needs = view.container.querySelector('.raid-needs') as HTMLElement
  const rows = () => [...needs.querySelectorAll('.raid-need')] as HTMLElement[]
  return { needs, rows, flareRows: () => rows().filter((row) => /РСП-30|RSP-30/.test(row.textContent ?? '')) }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => {
  setRenderLanguage('ru')
  vi.unstubAllGlobals()
})

describe('«Требования рейда»: the flare of an exit', () => {
  it('no quest: the exit\'s green flare on a line of its own, «Для выхода»', () => {
    const { flareRows } = renderOverview([])
    expect(flareRows()).toHaveLength(1)
    expect(flareRows()[0]).toHaveTextContent('Реактивный сигнальный патрон РСП-30 (Зеленый)')
    expect(flareRows()[0]).toHaveTextContent('Для выхода · ЖД проход')
    expect(flareRows()[0]).toHaveTextContent('+1')
  })

  it('«Прекратить огонь!» current: its flare only, no line for the exit', () => {
    const { flareRows } = renderOverview(['ceasefire'])
    expect(flareRows()).toHaveLength(1)
    expect(flareRows()[0]).toHaveTextContent('Подать сигнал · Прекратить огонь!')
    expect(flareRows()[0]).not.toHaveTextContent('Для выхода')
  })

  it('«Прекратить огонь!» put aside or not yet taken: the exit\'s line is back', () => {
    const { flareRows } = renderOverview(['ceasefire'], { pvp: ['ceasefire'] })
    expect(flareRows()).toHaveLength(1)
    expect(flareRows()[0]).toHaveTextContent('Для выхода')
  })

  it('a quest that fires the same green flare elsewhere: a second line for the exit', () => {
    const { flareRows } = renderOverview(['green-signal'])
    expect(flareRows()).toHaveLength(2)
    expect(flareRows().map((row) => row.textContent)).toEqual([expect.stringContaining('Подать сигнал · Зелёный сигнал'), expect.stringContaining('Для выхода')])
  })

  it('the hover card: the pistol with the cartridge and the calibre, RSP-30 without one; for a red flare too', async () => {
    const { flareRows, rows } = renderOverview(['red-signal'])
    fireEvent.mouseEnter(flareRows()[0])
    const card = await screen.findByRole('tooltip')
    expect(card).toHaveTextContent('Сигнальный пистолет · 26x75')
    expect(within(card).getByText('Сигнальный пистолет ЗиД СП-81 26x75')).toBeInTheDocument()
    expect(within(card).getByText('26x75 сигнальный патрон (Зеленый)')).toBeInTheDocument()
    expect(within(card).getByText('Без пистолета')).toBeInTheDocument()
    expect(within(card).getByText('Реактивный сигнальный патрон РСП-30 (Зеленый)')).toBeInTheDocument()
    fireEvent.mouseLeave(flareRows()[0])

    const red = rows().find((row) => /Красный/.test(row.textContent ?? ''))!
    expect(red).toHaveTextContent('Подать сигнал · Сигнал у ворот')
    fireEvent.mouseEnter(red)
    const redCard = (await screen.findAllByRole('tooltip')).at(-1)!
    expect(redCard).toHaveTextContent('Сигнальный пистолет · 26x75')
    expect(redCard).toHaveTextContent('Сигнальный пистолет ЗиД СП-81 26x75')
    expect(redCard).toHaveTextContent('26x75 сигнальный патрон (Красный)')
    expect(redCard).not.toHaveTextContent('Без пистолета')
  })

  it('in English', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    const { flareRows } = renderOverview([])
    expect(flareRows()[0]).toHaveTextContent('For the exit · Rail Passage')
    fireEvent.mouseEnter(flareRows()[0])
    const card = await screen.findByRole('tooltip')
    expect(card).toHaveTextContent('Signal pistol · 26x75')
    expect(card).toHaveTextContent('No pistol needed')
  })
})
