import { beforeEach, describe, expect, it } from 'vitest'
import { loadSavedBuilds, renameSavedBuild, saveBuild } from './buildStorage'

describe('«Избранные»: a saved build renamed in place (owner, 19.11.2026)', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the build, its parts and its time; an empty name changes nothing; other modes untouched', () => {
    const [first] = saveBuild('pvp', { name: 'АКМ', weaponId: 'akm', code: 'RB1.akm..x' })
    saveBuild('pve', { name: 'АКМ PvE', weaponId: 'akm', code: 'RB1.akm..y' })
    renameSavedBuild('pvp', first!.id, '  Тихий АКМ  ')
    const [renamed] = loadSavedBuilds('pvp')
    expect(renamed).toMatchObject({ id: first!.id, name: 'Тихий АКМ', code: 'RB1.akm..x', savedAt: first!.savedAt })
    renameSavedBuild('pvp', first!.id, '   ')
    expect(loadSavedBuilds('pvp')[0]!.name).toBe('Тихий АКМ')
    expect(loadSavedBuilds('pve')[0]!.name).toBe('АКМ PvE')
  })
})
