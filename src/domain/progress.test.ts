import { describe, expect, it } from 'vitest'
import { createLocalProfile, migrateProfile, setTaskProgress } from './progress'

describe('local profile model', () => {
  it('keeps PvP and PvE progress isolated', () => {
    const profile = createLocalProfile('BANGKOK', 'profile-1')
    const updated = setTaskProgress(profile, 'pvp', {
      taskId: 'debut', status: 'completed', source: 'manual', updatedAt: '2026-09-25T00:00:00.000Z',
    })
    expect(updated.modes.pvp.taskProgress.debut.status).toBe('completed')
    expect(updated.modes.pve.taskProgress.debut).toBeUndefined()
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
    expect(migrated?.schemaVersion).toBe(2)
    expect(migrated?.modes.pve.playerLevel).toBe(22)
    expect(migrated?.modes.pvp.playerLevel).toBe(1)
  })
})
