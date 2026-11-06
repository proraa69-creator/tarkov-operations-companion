import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import type { Item, Quest } from '../domain/types'
import { deferredQuestsKey } from '../progression/deferredQuests'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { AppStateProvider } from '../state/AppState'

const key = (itemId: string) => ({ itemId, purpose: 'key', count: 1, mapIds: ['customs'] })
const quest = (id: string, name: string, keys: string[]) => ({ id, name, normalizedName: id, trader: 'Прапор', level: 5, objectives: [], raidRequirements: keys.map(key) }) as unknown as Quest
const data = {
  items: [{ id: 'k1', name: 'Ключ от склада', shortName: 'Склад', category: 'Ключ' }, { id: 'k2', name: 'Ключ от гаража', shortName: 'Гараж', category: 'Ключ' }] as unknown as Item[],
  quests: [quest('q1', 'Первый', ['k1']), quest('q2', 'Второй', ['k1']), quest('q3', 'Третий', ['k2'])],
  maps: [{ id: 'customs', name: 'Таможня' }],
  traders: [],
}
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data }), useOptionalTarkovData: () => ({ data }) }))
vi.mock('../gunsmith/useGunsmithAccess', () => ({ useTraderLoyalty: () => new Map() }))
vi.mock('../progression/itemUnlocks', () => ({ useItemUnlocks: () => ({ isPending: false, isError: false, data: undefined }), unlockSources: () => [] }))

const { QuestKeysPage } = await import('./QuestKeysPage')

function open(done: string[] = []) {
  let profile = createLocalProfile('TEST', 'keys')
  for (const id of done) profile = setTaskProgress(profile, 'pvp', { taskId: id, status: 'completed', source: 'manual', updatedAt: '2026-11-05T00:00:00Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  render(<LocaleProvider><AppStateProvider><MemoryRouter><QuestKeysPage /></MemoryRouter></AppStateProvider></LocaleProvider>)
  return profile
}
const row = (name: string) => screen.getByText(name).closest('.quest-key') as HTMLElement
const tab = (name: RegExp) => screen.getByRole('button', { name })

describe('«Ключи для квестов»', () => {
  beforeEach(() => localStorage.clear())

  it('a key lists all its quests; a quest done leaves; the key moves to «Больше не нужны» with the last of them', () => {
    open(['q1'])
    const k1 = row('Ключ от склада')
    expect(within(k1).queryByRole('link', { name: 'Первый' })).toBeNull()
    expect(within(k1).getByRole('link', { name: 'Второй' })).toBeInTheDocument()
    expect(k1).toHaveTextContent('Выполнено: 1 из 2')
    expect(tab(/^Нужны/)).toHaveTextContent('Нужны · 2')
  })

  it('all done: only under «Больше не нужны», where its quests can be opened', () => {
    open(['q1', 'q2'])
    expect(screen.queryByText('Ключ от склада')).toBeNull()
    fireEvent.click(tab(/^Больше не нужны/))
    const k1 = row('Ключ от склада')
    expect(within(k1).getByRole('link', { name: 'Первый' })).toHaveAttribute('href', '/quests?filter=all&selected=q1')
    expect(screen.getByText(/можно убрать их из избранного в игре/)).toBeInTheDocument()
  })

  it('«Отложить» asks for how long; put aside for good, the quest no longer holds the key and comes back with «Вернуть»', () => {
    const profile = open()
    fireEvent.click(within(row('Ключ от гаража')).getByRole('button', { name: 'Отложить' }))
    const dialog = screen.getByRole('dialog')
    for (const kind of ['По времени', 'До уровня', 'Бессрочно']) expect(within(dialog).getByRole('radio', { name: kind })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Бессрочно' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отложить' }))
    expect(Object.keys(JSON.parse(localStorage.getItem(deferredQuestsKey(profile.id, 'pvp'))!))).toEqual(['q3'])
    expect(screen.queryByText('Ключ от гаража')).toBeNull()
    fireEvent.click(tab(/^Отложены/))
    const k2 = row('Ключ от гаража')
    expect(k2).toHaveTextContent('бессрочно')
    fireEvent.click(within(k2).getByRole('button', { name: 'Вернуть' }))
    expect(screen.queryByText('Ключ от гаража')).toBeNull()
    fireEvent.click(tab(/^Нужны/))
    expect(screen.getByText('Ключ от гаража')).toBeInTheDocument()
  })

  it('a key of several quests offers them all in the window, the pressed one ticked', () => {
    open()
    const k1 = row('Ключ от склада')
    fireEvent.click(within(within(k1).getByRole('link', { name: 'Второй' }).closest('li') as HTMLElement).getByRole('button', { name: 'Отложить' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('checkbox', { name: 'Первый' })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Второй' })).toBeChecked()
  })

  it('has no «Отмечен в игре» any more; the search and the map narrow the list', () => {
    open()
    expect(within(row('Ключ от склада')).queryByRole('checkbox')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск ключа или квеста…' }), { target: { value: 'третий' } })
    expect(screen.queryByText('Ключ от склада')).toBeNull()
    expect(screen.getByText('Ключ от гаража')).toBeInTheDocument()
  })
})
