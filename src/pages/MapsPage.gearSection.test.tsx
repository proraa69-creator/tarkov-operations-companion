import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDataset } from '../domain/types'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { fetchLiveCatalog } from '../data/catalogSource'
import { conditionQuestsFetcher } from '../data/__fixtures__/conditionQuestsFeed'
import fixture from '../data/__fixtures__/tarkovDevConditionQuests.json'

// Real tarkov.dev quests: «Работа для патриота» and «Стиляги» (Streets, gear conditions), «Тарковский стрелок. Часть 6»
// (any map, a weapon condition), «Ловкач» (Woods).
const ACTIVE = ['64f5deac39e45b527a7c4232', '65734c186dc1e402c80dc19e', '5bc4856986f77454c317bea7', '60e729cf5698ee7b05057439']
const GEAR = ['Работа для патриота', 'Стиляги', 'Тарковский стрелок. Часть 6']

async function renderStreets() {
  const catalog: AppDataset = await fetchLiveCatalog('pvp', 'ru', conditionQuestsFetcher(fixture as unknown as Record<string, unknown>), { wiki: async () => ({ titles: [], pages: [], storyQuests: [] }) })
  let profile = createLocalProfile('TEST', 'gear-section')
  profile = { ...profile, modes: { ...profile.modes, pvp: { ...profile.modes.pvp, playerLevel: 42 } } }
  for (const taskId of ACTIVE) profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-10-15T08:00:00.000Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], catalog)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={['/maps/streets-of-tarkov']}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { setRenderLanguage('ru'); vi.restoreAllMocks(); vi.unstubAllGlobals() })

// The whole Maps page on the real catalog: slower than 5 s on a loaded machine.
describe('Maps page: «С условиями на снаряжение»', () => {
  it('lists the quests with gear conditions in their own section at the bottom; the sheet shows the build to take', async () => {
    const { container } = await renderStreets()
    const section = await waitFor(() => {
      const found = container.querySelector('.map-gear-section') as HTMLElement | null
      expect(found).not.toBeNull()
      return found!
    })
    expect(section.querySelector('.gear-section-head')).toHaveTextContent('С условиями на снаряжение')
    const names = [...section.querySelectorAll('.quest-map-row h3')].map((node) => node.textContent)
    expect(names.sort()).toEqual([...GEAR].sort())
    // not in «Актуальные квесты» or «Любая карта» above it
    const others = [...container.querySelectorAll('.quest-map-row:not(.is-gear) h3')].map((node) => node.textContent)
    for (const name of GEAR) expect(others).not.toContain(name)
    // the section comes after the other quests
    const rows = [...container.querySelectorAll('.quest-map-row')]
    expect(rows.slice(-GEAR.length).every((row) => row.classList.contains('is-gear'))).toBe(true)

    fireEvent.click([...section.querySelectorAll('.quest-map-row-main')].find((button) => button.textContent?.includes('Работа для патриота'))!)
    const block = await waitFor(() => {
      const found = container.querySelector('.map-quest-sheet .qc-raid-gear') as HTMLElement | null
      expect(found).not.toBeNull()
      return found!
    })
    expect(block).toHaveTextContent('Снаряжение для рейда')
    expect(block.querySelector('.qc-weapon-card')).toHaveTextContent('АК-12')
    expect(block).toHaveTextContent('ПС-320')
    expect(block).toHaveTextContent('Глушитель 5.45x39 для АК-12')
    expect(block).toHaveTextContent('Условия убийства')
    expect(screen.getAllByText('Работа для патриота').length).toBeGreaterThan(1)
  }, 20_000)

  it('speaks English', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    const { container } = await renderStreets()
    await waitFor(() => expect(container.querySelector('.map-gear-section .gear-section-head')).toHaveTextContent('Gear conditions'))
    fireEvent.click(container.querySelector('.map-gear-section .quest-map-row-main')!)
    await waitFor(() => expect(container.querySelector('.map-quest-sheet .qc-raid-gear')).toHaveTextContent('Raid gear'))
    expect(container.querySelector('.map-quest-sheet .qc-raid-gear')).toHaveTextContent('Kill conditions')
  }, 20_000)
})
