import { describe, expect, it } from 'vitest'
import { applyPlayerSnapshot, createLocalProfile, migrateProfile, registerModeProfile, setTaskProgress } from './progress'

describe('local profile model', () => {
  it('preserves confirmed PvE trader-task scans after restart', () => {
    const profile = setTaskProgress(createLocalProfile('Operator'), 'pve', { taskId: 'debut', status: 'active', source: 'screen-scan', updatedAt: '2026-09-28T00:00:00Z' })
    expect(migrateProfile(profile)?.modes.pve.taskProgress.debut).toEqual(profile.modes.pve.taskProgress.debut)
    expect(migrateProfile(profile)?.modes.pvp.taskProgress.debut).toBeUndefined()
  })
  it('keeps PvP, PvE and Seasonal progress isolated', () => {
    const profile = createLocalProfile('BANGKOK', 'profile-1')
    const updated = setTaskProgress(profile, 'pvp', {
      taskId: 'debut', status: 'completed', source: 'manual', updatedAt: '2026-09-25T00:00:00.000Z',
    })
    expect(updated.modes.pvp.taskProgress.debut.status).toBe('completed')
    expect(updated.modes.pve.taskProgress.debut).toBeUndefined()
    expect(updated.modes.seasonal.taskProgress.debut).toBeUndefined()
  })

  it('does not downgrade imported completion with an older automatic event', () => {
    const complete = setTaskProgress(createLocalProfile('Operator', 'profile-2'), 'pvp', {
      taskId: 'checking', status: 'completed', source: 'eft-log', updatedAt: '2026-09-25T00:00:00.000Z',
    })
    const result = setTaskProgress(complete, 'pvp', {
      taskId: 'checking', status: 'active', source: 'eft-log', updatedAt: '2026-09-24T00:00:00.000Z',
    })
    expect(result).toBe(complete)
  })

  it('migrates a partial profile to the current schema', () => {
    const migrated = migrateProfile({
      id: 'legacy', displayName: 'Legacy', selectedMode: 'pve', modes: { pvp: {}, pve: { playerLevel: 22 } },
    })
    expect(migrated?.schemaVersion).toBe(6)
    expect(migrated?.modes.pve.playerLevel).toBe(22)
    expect(migrated?.modes.pvp.playerLevel).toBe(1)
    expect(migrated?.modes.seasonal.playerLevel).toBe(1)
    expect(migrated?.modes.seasonal.registration.status).toBe('unregistered')
    expect(migrated?.modes.pvp.raidItemIds).toEqual([])
  })

  it('registers a nickname only for the selected mode', () => {
    const profile = registerModeProfile(createLocalProfile('Operator'), 'pve', {
      accountId: 7690289,
      enteredNickname: 'shaurma',
      nickname: 'Shaurma',
      verifiedAt: '2026-09-26T00:00:00.000Z',
    })
    expect(profile.modes.pve.registration).toMatchObject({ status: 'registered', accountId: 7690289, nickname: 'Shaurma' })
    expect(profile.modes.pvp.registration.status).toBe('unregistered')
    expect(profile.modes.seasonal.registration.status).toBe('unregistered')
  })

  it('keeps favorites when binding or rebinding a nickname', () => {
    const withFavorites = {
      ...createLocalProfile('Operator'),
      modes: {
        ...createLocalProfile('Operator').modes,
        pvp: {
          ...createLocalProfile('Operator').modes.pvp,
          favoriteItemIds: ['ledx', 'graphics-card'],
          raidItemIds: ['salewa'],
        },
      },
    }
    const firstBind = registerModeProfile(withFavorites, 'pvp', {
      accountId: 1,
      enteredNickname: 'shaurma',
      nickname: 'SHAURMA',
      verifiedAt: '2026-09-26T00:00:00.000Z',
    })
    expect(firstBind.modes.pvp.favoriteItemIds).toEqual(['ledx', 'graphics-card'])
    expect(firstBind.modes.pvp.raidItemIds).toEqual(['salewa'])

    const rebound = registerModeProfile(firstBind, 'pvp', {
      accountId: 2,
      enteredNickname: 'other',
      nickname: 'Other',
      verifiedAt: '2026-09-26T01:00:00.000Z',
    })
    expect(rebound.modes.pvp.favoriteItemIds).toEqual(['ledx', 'graphics-card'])
    expect(rebound.modes.pvp.raidItemIds).toEqual(['salewa'])
    expect(rebound.modes.pvp.registration.accountId).toBe(2)
  })

  it('shares favorites across modes during migration', () => {
    const migrated = migrateProfile({
      id: 'legacy',
      displayName: 'Legacy',
      selectedMode: 'pvp',
      modes: {
        pvp: { favoriteItemIds: ['ledx'] },
        pve: { favoriteItemIds: ['salewa'] },
        seasonal: {},
      },
    })
    expect(migrated?.modes.pvp.favoriteItemIds).toEqual(['ledx', 'salewa'])
    expect(migrated?.modes.pve.favoriteItemIds).toEqual(['ledx', 'salewa'])
    expect(migrated?.modes.seasonal.favoriteItemIds).toEqual(['ledx', 'salewa'])
  })

  it('does not replace a newer player snapshot with an older one', () => {
    const profile = createLocalProfile('Operator')
    const newer = applyPlayerSnapshot(profile, 'pvp', {
      accountId: 1, nickname: 'Shaurma', experience: 1000, level: 10, faction: 'usec', prestige: 0,
      fetchedAt: '2026-09-26T02:00:00.000Z', upstreamUpdatedAt: '2026-09-26T01:00:00.000Z',
    })
    const older = applyPlayerSnapshot(newer, 'pvp', {
      accountId: 1, nickname: 'Shaurma', experience: 500, level: 5, faction: 'usec', prestige: 0,
      fetchedAt: '2026-09-26T03:00:00.000Z', upstreamUpdatedAt: '2026-09-25T01:00:00.000Z',
    })
    expect(older.modes.pvp.playerLevel).toBe(10)
    expect(older.modes.pvp.playerSnapshot?.experience).toBe(1000)
  })
})
