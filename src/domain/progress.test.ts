import { describe, expect, it } from 'vitest'
import { applyLevelEstimate, applyPlayerSnapshot, applyScreenLevel, createLocalProfile, migrateProfile, registerModeProfile, setManualLevel, setTaskProgress, wipeModeProgress } from './progress'
import type { LocalProfile, PlayerProfileSnapshot, RaidMode } from './types'

describe('local profile model', () => {
  it('preserves the saved character and progress when the server returns no snapshot', () => {
    const profile = applyPlayerSnapshot(createLocalProfile('Operator'), 'pvp', {
      accountId: 1, nickname: 'Operator', experience: 1000, level: 10, faction: 'usec', prestige: 0,
      fetchedAt: '2026-09-26T02:00:00.000Z',
    })
    expect(applyPlayerSnapshot(profile, 'pvp', null)).toBe(profile)
    expect(applyPlayerSnapshot(profile, 'pvp', undefined)).toBe(profile)
  })
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

describe('the character level (player\'s report, 14.10.2026: «в PVE … 39 у моего ЧВК, в приложении отображается 59»)', () => {
  const snapshot = (level: number, experience: number, upstreamUpdatedAt: string): PlayerProfileSnapshot => ({
    accountId: 5550123, nickname: 'Raid_OS', experience, level, faction: 'usec', prestige: 0, fetchedAt: upstreamUpdatedAt, upstreamUpdatedAt,
  })
  /** A level the reader before 14.10.2026 stored (OCR alone, which took the game's «3» for a «5»). */
  const stored = (profile: LocalProfile, mode: RaidMode, level: number, observedAt: string): LocalProfile => ({
    ...profile, modes: { ...profile.modes, [mode]: { ...profile.modes[mode], playerLevel: level, levelAnchor: { level, observedAt, source: 'screen' } } },
  })
  const levels = (profile: LocalProfile) => [profile.modes.pvp.playerLevel, profile.modes.pve.playerLevel, profile.modes.seasonal.playerLevel]

  it('the next «Выбор профиля и режима» reading takes the stored PvE 59 down to 39; PvP and the season keep theirs', () => {
    let profile = stored(stored(createLocalProfile('Operator'), 'pve', 59, '2026-10-13T20:00:00.000Z'), 'pvp', 59, '2026-10-13T20:00:00.000Z')
    profile = applyScreenLevel(profile, 'pve', 39, '2026-10-14T18:00:00.000Z')
    expect(levels(profile)).toEqual([59, 39, 1])
    expect(profile.modes.pve.levelAnchor).toEqual({ level: 39, observedAt: '2026-10-14T18:00:00.000Z', source: 'screen', checked: true })
  })

  it('the traders\' screen may lower a level the old reader stored, never a checked one', () => {
    const before = stored(createLocalProfile('Operator'), 'pve', 59, '2026-10-13T20:00:00.000Z')
    const healed = applyScreenLevel(before, 'pve', 39, '2026-10-14T18:00:00.000Z', true)
    expect(healed.modes.pve.playerLevel).toBe(39)
    // A checked level: another mode's traders' screen (the logs' mode a moment behind) must not lower it.
    expect(applyScreenLevel(healed, 'pve', 12, '2026-10-14T18:10:00.000Z', true).modes.pve.playerLevel).toBe(39)
  })

  it('a raise no play explains since the last reading is not taken: PvP\'s traders\' screen read as PvE\'s, or a misread digit', () => {
    let profile = applyScreenLevel(createLocalProfile('Operator'), 'pve', 39, '2026-10-14T18:00:00.000Z')
    expect(applyScreenLevel(profile, 'pve', 59, '2026-10-14T19:00:00.000Z', true).modes.pve.playerLevel).toBe(39)
    expect(applyScreenLevel(profile, 'pve', 59, '2026-10-14T19:00:00.000Z').modes.pve.playerLevel).toBe(39)
    profile = applyScreenLevel(profile, 'pve', 40, '2026-10-14T19:00:00.000Z', true)
    expect(profile.modes.pve).toMatchObject({ playerLevel: 40, levelAnchor: { level: 40, source: 'screen', checked: true } })
  })

  it('Tarkov.dev\'s exact experience overturns a screen level it could not have reached by then', () => {
    // Tarkov.dev: 39 with 3 700 000 experience at 08:00; the screen said 59 twelve hours later (13 million more).
    const misread = stored(createLocalProfile('Operator'), 'pve', 59, '2026-10-14T20:00:00.000Z')
    const healed = applyPlayerSnapshot(misread, 'pve', snapshot(39, 3_700_000, '2026-10-14T08:00:00.000Z'))
    expect(healed.modes.pve).toMatchObject({ playerLevel: 39, levelAnchor: { level: 39, source: 'tarkov-dev', experience: 3_700_000 } })
    // A screen level within reach stays (the newer reading wins, as before).
    const played = applyScreenLevel(createLocalProfile('Operator'), 'pve', 40, '2026-10-14T20:00:00.000Z')
    const kept = applyPlayerSnapshot(played, 'pve', snapshot(39, 3_700_000, '2026-10-14T08:00:00.000Z'))
    expect(kept.modes.pve).toMatchObject({ playerLevel: 40, levelAnchor: { level: 40, source: 'screen' } })
    // And Tarkov.dev's PvE profile leaves PvP alone.
    expect(levels(healed)).toEqual([1, 39, 1])
  })

  it('nor does a newer Tarkov.dev level no play explains since a checked screen reading replace it', () => {
    // E.g. experience from before a prestige counted in: 39 on the game's screen at 18:00, «59» from Tarkov.dev at 19:00.
    const read = applyScreenLevel(createLocalProfile('Operator'), 'pve', 39, '2026-10-14T18:00:00.000Z')
    const kept = applyPlayerSnapshot(read, 'pve', snapshot(59, 16_800_000, '2026-10-14T19:00:00.000Z'))
    expect(kept.modes.pve).toMatchObject({ playerLevel: 39, levelAnchor: { level: 39, source: 'screen' } })
    expect(kept.modes.pve.playerSnapshot?.level).toBe(59)
    // A level within reach (or a lower one: a prestige) is taken as before.
    expect(applyPlayerSnapshot(read, 'pve', snapshot(40, 4_100_000, '2026-10-14T19:00:00.000Z')).modes.pve.playerLevel).toBe(40)
    expect(applyPlayerSnapshot(read, 'pve', snapshot(1, 0, '2026-10-14T19:00:00.000Z')).modes.pve.playerLevel).toBe(1)
  })
})

/**
 * Owner, 27.11.2026: «нижняя граница уровня по квестам и ручной ввод уровня». A PvP player without a public profile whose
 * «Выбор профиля и режима» was not read: the level the mode's completed quests prove, and «Указать уровень».
 */
describe('the level without a reading: the quests\' estimate and the player\'s own entry', () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 10, 27, hour)).toISOString()
  const snapshot = (level: number, experience: number, upstreamUpdatedAt: string): PlayerProfileSnapshot => ({
    accountId: 5550123, nickname: 'Raid_OS', experience, level, faction: 'usec', prestige: 0, fetchedAt: upstreamUpdatedAt, upstreamUpdatedAt,
  })
  const levels = (profile: LocalProfile) => [profile.modes.pvp.playerLevel, profile.modes.pve.playerLevel, profile.modes.seasonal.playerLevel]

  it('the estimate fills a mode with no anchor, follows its quests both ways and leaves the other modes alone', () => {
    let profile = applyLevelEstimate(createLocalProfile('Operator'), 'pvp', 24)
    expect(levels(profile)).toEqual([24, 1, 1])
    expect(profile.modes.pvp.levelAnchor).toBeUndefined()
    // A mark taken back: the estimate goes down with it.
    profile = applyLevelEstimate(profile, 'pvp', 22)
    expect(profile.modes.pvp.playerLevel).toBe(22)
    expect(applyLevelEstimate(profile, 'pvp', 22)).toBe(profile)
    for (const wrong of [0, 80, 22.5, Number.NaN]) expect(applyLevelEstimate(profile, 'pvp', wrong)).toBe(profile)
    profile = applyLevelEstimate(profile, 'seasonal', 9)
    expect(levels(profile)).toEqual([22, 1, 9])
  })

  it('a reading of the game or Tarkov.dev always replaces the estimate; the traders\' screen only above it', () => {
    const estimated = applyLevelEstimate(createLocalProfile('Operator'), 'pvp', 24)
    // «Выбор профиля и режима» names its mode: its level, lower than the estimate or not.
    const read = applyScreenLevel(estimated, 'pvp', 22, at(10))
    expect(read.modes.pvp).toMatchObject({ playerLevel: 22, levelAnchor: { level: 22, source: 'screen' } })
    // From then on the quests' estimate changes nothing.
    expect(applyLevelEstimate(read, 'pvp', 30)).toBe(read)
    expect(applyPlayerSnapshot(estimated, 'pvp', snapshot(23, 700_000, at(9))).modes.pvp).toMatchObject({ playerLevel: 23, levelAnchor: { level: 23, source: 'tarkov-dev' } })
    // The traders' screen takes the logs' mode, maybe another one's: never below what this mode's quests prove.
    expect(applyScreenLevel(estimated, 'pvp', 12, at(10), true)).toBe(estimated)
    expect(applyScreenLevel(estimated, 'pvp', 26, at(10), true).modes.pvp).toMatchObject({ playerLevel: 26, levelAnchor: { level: 26, source: 'screen' } })
  })

  it('the entry: 1–79, the mode\'s anchor from then on, its own mode only, corrected by the player, never over a reading', () => {
    let profile = applyLevelEstimate(applyLevelEstimate(createLocalProfile('Operator'), 'pvp', 24), 'pve', 10)
    for (const wrong of [0, 80, 24.5, Number.NaN]) expect(setManualLevel(profile, 'pvp', wrong, at(10))).toBe(profile)
    profile = setManualLevel(profile, 'pvp', 31, at(10))
    expect(profile.modes.pvp).toMatchObject({ playerLevel: 31, levelAnchor: { level: 31, observedAt: at(10), source: 'manual' } })
    expect(levels(profile)).toEqual([31, 10, 1])
    expect(profile.modes.pve.levelAnchor).toBeUndefined()
    // A slip corrected by the player; an older entry (another device's) does not replace a newer one.
    profile = setManualLevel(profile, 'pvp', 30, at(11))
    expect(profile.modes.pvp.levelAnchor).toMatchObject({ level: 30, observedAt: at(11), source: 'manual' })
    expect(setManualLevel(profile, 'pvp', 40, at(10))).toBe(profile)
    // A level the game's screen or Tarkov.dev gave is never replaced by an entry.
    const read = applyScreenLevel(createLocalProfile('Operator'), 'pvp', 22, at(9))
    expect(setManualLevel(read, 'pvp', 30, at(10))).toBe(read)
    const looked = applyPlayerSnapshot(createLocalProfile('Operator'), 'pvp', snapshot(22, 600_000, at(9)))
    expect(setManualLevel(looked, 'pvp', 30, at(10))).toBe(looked)
  })

  it('a newer reading replaces the entry by the freshness rules of the readings; an older one does not', () => {
    const typed = setManualLevel(createLocalProfile('Operator'), 'pvp', 12, at(10))
    // «Выбор профиля и режима» read before the entry (kept while the app was locked): older, the entry stays.
    expect(applyScreenLevel(typed, 'pvp', 14, at(9))).toBe(typed)
    // After it: the game's level whatever it is, lower, or far above a slip of the keyboard (12 for 42).
    expect(applyScreenLevel(typed, 'pvp', 42, at(11)).modes.pvp).toMatchObject({ playerLevel: 42, levelAnchor: { level: 42, source: 'screen', checked: true } })
    expect(applyScreenLevel(typed, 'pvp', 9, at(11)).modes.pvp.playerLevel).toBe(9)
    // The traders' screen, maybe another mode's: never lower, and only within reach, as after any reading.
    expect(applyScreenLevel(typed, 'pvp', 9, at(11), true)).toBe(typed)
    expect(applyScreenLevel(typed, 'pvp', 42, at(11), true)).toBe(typed)
    expect(applyScreenLevel(typed, 'pvp', 13, at(11), true).modes.pvp).toMatchObject({ playerLevel: 13, levelAnchor: { level: 13, source: 'screen' } })
    // Tarkov.dev: a newer profile replaces the entry; an older one does not, unless the entry is beyond its reach.
    expect(applyPlayerSnapshot(typed, 'pvp', snapshot(11, 80_000, at(11))).modes.pvp.levelAnchor).toMatchObject({ level: 11, source: 'tarkov-dev', experience: 80_000 })
    const older = applyPlayerSnapshot(typed, 'pvp', snapshot(11, 80_000, at(9)))
    expect(older.modes.pvp).toMatchObject({ playerLevel: 12, levelAnchor: { level: 12, source: 'manual' } })
    expect(older.modes.pvp.playerSnapshot?.level).toBe(11)
    // 59 typed an hour after Tarkov.dev's 39 with 3 700 000 experience: 13 million more, no play gives it.
    const slip = setManualLevel(createLocalProfile('Operator'), 'pve', 59, at(10))
    expect(applyPlayerSnapshot(slip, 'pve', snapshot(39, 3_700_000, at(9))).modes.pve).toMatchObject({ playerLevel: 39, levelAnchor: { level: 39, source: 'tarkov-dev' } })
  })

  it('«Сброс», «Вайп» and «Престиж +» clear the entry with the rest; an entry from before the reset does not come back', () => {
    const typed = setManualLevel(applyLevelEstimate(createLocalProfile('Operator'), 'pve', 17), 'pvp', 30, at(10))
    for (const prestige of [{ keep: true }, { level: 2 }]) {
      const wiped = wipeModeProgress(typed, 'pvp', at(12), at(12), prestige, { at: at(12) })
      expect(wiped.modes.pvp.levelAnchor).toBeUndefined()
      expect(levels(wiped)).toEqual([1, 17, 1])
      expect(setManualLevel(wiped, 'pvp', 30, at(11))).toBe(wiped)
    }
  })
})
