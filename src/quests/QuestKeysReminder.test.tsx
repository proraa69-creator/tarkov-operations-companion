import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import type { Item, Quest, RaidMode } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { AppStateProvider } from '../state/AppState'
import { QUEST_KEY_REMIND_AGAIN_MS, questKeysToldAt, rememberQuestKeysTold, setQuestKeyFavorite, writeQuestKeyReminder } from './questKeyFavorites'

const ids = Array.from({ length: 12 }, (_, index) => `k${index}`)
const data = {
  items: ids.map((id) => ({ id, name: `Ключ ${id}`, shortName: id, category: 'Ключ' })) as unknown as Item[],
  quests: ids.map((id) => ({ id: `q-${id}`, name: `Квест ${id}`, normalizedName: id, trader: 'Прапор', level: 5, objectives: [], raidRequirements: [{ itemId: id, purpose: 'key', count: 1, mapIds: [] }] })) as unknown as Quest[],
  maps: [],
  traders: [],
  metadata: { mode: 'pvp' },
}
const env = vi.hoisted(() => ({ inRaid: false, source: 'live' }))
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data, source: env.source }), useOptionalTarkovData: () => ({ data, source: env.source }) }))
vi.mock('../gunsmith/useGunsmithAccess', () => ({ useTraderLoyalty: () => new Map() }))
vi.mock('../app/useRaidState', () => ({ useRaidState: () => null, raidRunning: () => env.inRaid }))

const { QuestKeysReminder } = await import('./QuestKeysReminder')

const notify = vi.fn(() => Promise.resolve(true))
const Where = () => <span data-testid="where">{useLocation().pathname}{useLocation().search}</span>

/** `stale` keys starred under «Больше не нужны» (their quests done), `count` starred in all. */
function open({ stale, starred = stale, mode = 'pvp', reminder = true }: { stale: number; starred?: number; mode?: RaidMode; reminder?: boolean }) {
  let profile = { ...createLocalProfile('TEST', 'keys'), selectedMode: mode }
  for (const id of ids.slice(0, stale)) profile = setTaskProgress(profile, 'pvp', { taskId: `q-${id}`, status: 'completed', source: 'manual', updatedAt: '2026-11-05T00:00:00Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  for (const id of ids.slice(0, starred)) setQuestKeyFavorite(profile.id, 'pvp', id, true)
  if (reminder) writeQuestKeyReminder(true)
  const view = render(<LocaleProvider><AppStateProvider><MemoryRouter><QuestKeysReminder /><Where /></MemoryRouter></AppStateProvider></LocaleProvider>)
  return { profile, ...view }
}
const message = () => screen.queryByRole('status')

describe('the message of «Ключи для квестов»', () => {
  beforeEach(() => {
    localStorage.clear()
    notify.mockClear()
    env.inRaid = false
    env.source = 'live'
    ;(window as unknown as { tarkovDesktop?: unknown }).tarkovDesktop = { notify }
  })

  it('off by default: 12 keys to take off, and nothing comes', () => {
    open({ stale: 12, reminder: false })
    expect(message()).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })

  it('turned on, 9 say nothing, even with 12 starred', () => {
    open({ stale: 9, starred: 12 })
    expect(message()).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })

  it('from 10: once, in the system and in the window, and leads to «Избранные ключи»', () => {
    const { profile, rerender } = open({ stale: 10 })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Ключи для квестов · PvP', 'В избранном больше не нужны: 10. Снимите их.')
    expect(questKeysToldAt(profile.id, 'pvp')).toBeTypeOf('number')
    rerender(<LocaleProvider><AppStateProvider><MemoryRouter><QuestKeysReminder /><Where /></MemoryRouter></AppStateProvider></LocaleProvider>)
    expect(notify).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Снимите их/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/quest-keys?tab=favorites')
    expect(message()).toBeNull()
  })

  it('given today, it does not come again at the next start; given a day ago, it does', () => {
    const { profile, unmount } = open({ stale: 10 })
    unmount()
    notify.mockClear()
    render(<LocaleProvider><AppStateProvider><MemoryRouter><QuestKeysReminder /></MemoryRouter></AppStateProvider></LocaleProvider>)
    expect(notify).not.toHaveBeenCalled()
    expect(message()).toBeNull()
    rememberQuestKeysTold(profile.id, 'pvp', Date.now() - QUEST_KEY_REMIND_AGAIN_MS)
    render(<LocaleProvider><AppStateProvider><MemoryRouter><QuestKeysReminder /></MemoryRouter></AppStateProvider></LocaleProvider>)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('never during a raid, and not counted as given', () => {
    env.inRaid = true
    const { profile } = open({ stale: 12 })
    expect(notify).not.toHaveBeenCalled()
    expect(message()).toBeNull()
    expect(questKeysToldAt(profile.id, 'pvp')).toBeUndefined()
  })

  it('not from the built-in catalog, before the real one comes', () => {
    env.source = 'demo'
    open({ stale: 12 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('the stars of another mode do not count', () => {
    open({ stale: 12, mode: 'pve' })
    expect(notify).not.toHaveBeenCalled()
    expect(message()).toBeNull()
  })

  it('goes away when turned off', () => {
    open({ stale: 10 })
    expect(message()).not.toBeNull()
    act(() => writeQuestKeyReminder(false))
    expect(message()).toBeNull()
  })
})
