import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import type { LocalProfile, Quest, RaidMode } from '../domain/types'
import { AppStateProvider, useAppState } from '../state/AppState'
import { useQuestExperienceLevel } from './questExperience'

/** The catalog the hook sees (src/data/DataProvider.tsx): the quests of the shown mode and where they came from. */
const catalog = vi.hoisted(() => ({ value: { data: { quests: [] as unknown[] }, source: 'live' as 'live' | 'cache' | 'demo' } }))
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => catalog.value }))

const QUESTS = [
  { id: 'debut', level: 1, experience: 3000 },
  { id: 'shooter', level: 15, experience: 500 },
  { id: 'courier', level: 2, experience: 9000 },
] as unknown as Quest[]
const PROFILE_KEY = 'tarkov-operations-profiles-v2'

const probe: { app?: ReturnType<typeof useAppState> } = {}
/** AppShell's part: the hook on the shown mode. */
function Shell() {
  const app = useAppState()
  useQuestExperienceLevel()
  useEffect(() => { probe.app = app })
  return null
}
const app = () => probe.app!
const level = (mode: RaidMode) => app().activeProfile.modes[mode]
const done = (profile: LocalProfile, mode: RaidMode, taskId: string) => setTaskProgress(profile, mode, { taskId, status: 'completed', source: 'eft-log', updatedAt: '2026-11-27T09:00:00.000Z' })

beforeEach(() => {
  localStorage.clear()
  catalog.value = { data: { quests: QUESTS }, source: 'live' }
  // PvP: «shooter» (level 15) and «debut» done; PvE: «debut» and «courier» (3000 + 9000 experience: level 4); the season: nothing.
  let profile = createLocalProfile('Operator', 'level-estimate')
  profile = done(done(profile, 'pvp', 'shooter'), 'pvp', 'debut')
  profile = done(done(profile, 'pve', 'debut'), 'pve', 'courier')
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
})

/** Owner, 27.11.2026: «нижняя граница уровня по квестам и ручной ввод уровня». */
describe('useQuestExperienceLevel without a reading of the level', () => {
  it('gives the shown mode the level its completed quests prove; each mode its own once shown', () => {
    render(<AppStateProvider><Shell /></AppStateProvider>)
    expect(level('pvp')).toMatchObject({ playerLevel: 15 })
    expect(level('pvp').levelAnchor).toBeUndefined()
    expect([level('pve').playerLevel, level('seasonal').playerLevel]).toEqual([1, 1])
    act(() => app().setRaidMode('pve'))
    expect([level('pvp').playerLevel, level('pve').playerLevel, level('seasonal').playerLevel]).toEqual([15, 4, 1])
  })

  it('waits for the catalog: the demo data and an empty list prove nothing', () => {
    catalog.value = { data: { quests: QUESTS }, source: 'demo' }
    const view = render(<AppStateProvider><Shell /></AppStateProvider>)
    expect(level('pvp').playerLevel).toBe(1)
    catalog.value = { data: { quests: [] }, source: 'live' }
    view.rerender(<AppStateProvider><Shell /></AppStateProvider>)
    expect(level('pvp').playerLevel).toBe(1)
  })

  it('the player\'s entry replaces the estimate, a newer reading the entry, and «Вайп» clears it', () => {
    render(<AppStateProvider><Shell /></AppStateProvider>)
    act(() => app().setManualLevel('pvp', 31))
    expect(level('pvp')).toMatchObject({ playerLevel: 31, levelAnchor: { level: 31, source: 'manual' } })
    // The other modes keep theirs.
    expect(level('pve').levelAnchor).toBeUndefined()
    act(() => app().applyScreenLevel('pvp', 29, new Date(Date.now() + 60_000).toISOString()))
    expect(level('pvp')).toMatchObject({ playerLevel: 29, levelAnchor: { level: 29, source: 'screen' } })
    // An entry no longer goes over the game's reading.
    act(() => app().setManualLevel('pvp', 40))
    expect(level('pvp').playerLevel).toBe(29)

    act(() => app().setManualLevel('pve', 12))
    act(() => app().resetModeProgress('pve', new Date(Date.now() + 120_000).toISOString(), 'wipe'))
    expect(level('pve').levelAnchor).toBeUndefined()
    expect(level('pve').playerLevel).toBe(1)
    expect(level('pvp')).toMatchObject({ playerLevel: 29, levelAnchor: { source: 'screen' } })
  })
})
