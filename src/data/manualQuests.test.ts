import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { MISSING_OBJECTIVE_KEYS, SEASON_BORROWED_TASKS, SEASON_TASK_FIXES, STALE_QUEST_KEYS } from './catalogSource'
import { MANUAL_QUESTS, manualQuest, markManualQuests, unmatchedManualFixes } from './manualQuests'
import { QUEST_EXTRA_PLACES, QUEST_POINT_FLOORS } from './mapMarkerAdapter'
import { OWNER_GUNSMITH_ADDITIONS } from './ownerGunsmithGuides'
import { CORRECTED_QUEST_IDS } from './questCorrections'
import { STALE_OBJECTIVE_MAPS } from './stalePlaces'

const quest = (id: string, objectives: Array<{ id: string; gameId?: string }> = []): Quest => ({
  id, normalizedName: id, name: id, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [],
  objectiveDetails: objectives.map((objective) => ({ ...objective, type: 'visit', description: objective.id, count: 1 })),
} as unknown as Quest)

describe('the quests changed by hand (owner, 23.11.2026: «помечай. И при обновлениях из базы их не трогай»)', () => {
  it('lists every quest and objective a hand fix in the code is written for', () => {
    const quests = new Set(Object.keys(MANUAL_QUESTS))
    const objectives = new Set(Object.values(MANUAL_QUESTS).flatMap((entry) => entry.fixes.flatMap((fix) => fix.objectives ?? [])))
    const fixedQuests = [
      ...CORRECTED_QUEST_IDS, ...Object.keys(STALE_QUEST_KEYS), ...Object.keys(SEASON_TASK_FIXES), ...SEASON_BORROWED_TASKS,
      ...OWNER_GUNSMITH_ADDITIONS.map((addition) => addition.questId),
    ]
    const fixedObjectives = [
      ...Object.keys(MISSING_OBJECTIVE_KEYS), ...Object.keys(QUEST_POINT_FLOORS), ...Object.keys(QUEST_EXTRA_PLACES), ...Object.keys(STALE_OBJECTIVE_MAPS),
      ...Object.values(SEASON_TASK_FIXES).flatMap((fix) => Object.keys(fix.objectives)),
    ]
    expect(fixedQuests.filter((id) => !quests.has(id))).toEqual([])
    expect(fixedObjectives.filter((id) => !objectives.has(id))).toEqual([])
  })

  it('every entry has its date, what changed and where from; the game ids are ids', () => {
    for (const [id, entry] of Object.entries(MANUAL_QUESTS)) {
      expect(id).toMatch(/^[0-9a-f]{24}$/)
      expect(entry.name).toBeTruthy()
      expect(entry.fixes.length).toBeGreaterThan(0)
      for (const fix of entry.fixes) {
        expect(fix.date).toMatch(/^2026-\d\d-\d\d$/)
        expect(fix.what && fix.source).toBeTruthy()
        for (const objective of fix.objectives ?? []) expect(objective).toMatch(/^[0-9a-f]{24}$/)
      }
      for (const mode of entry.modes ?? []) expect(['pvp', 'pve', 'seasonal']).toContain(mode)
    }
  })

  it('marks them in the catalog with the date and what was changed, a Season-only fix in Season only', () => {
    const [vitamins, other] = markManualQuests([quest('5b478eca86f7744642012254'), quest('other')], 'pve')
    expect(vitamins!.manualCorrection).toMatchObject({ checkedAt: '2026-11-23' })
    expect(vitamins!.manualCorrection!.changes).toHaveLength(2)
    expect(vitamins!.manualCorrection!.changes![1]).toMatch(/^2026-11-23: Берег убран/)
    expect(other!.manualCorrection).toBeUndefined()
    expect(manualQuest('67d03be712fb5f8fd2096332', 'pvp')).toBeUndefined()
    expect(manualQuest('67d03be712fb5f8fd2096332', 'seasonal')?.name).toBe('Освободить помещение')
    // a pinned correction keeps its own source and date (src/data/questCorrections.ts)
    const pinned = { ...quest('64f5deac39e45b527a7c4232'), manualCorrection: { source: 'tarkov.help', checkedAt: '2026-10-14' } }
    expect(markManualQuests([pinned], 'pvp')[0]!.manualCorrection).toMatchObject({ source: 'tarkov.help', checkedAt: '2026-10-14', changes: [expect.stringContaining('2026-10-14')] })
  })

  it('names a fix whose objective the data no longer has, and a quest the data no longer has', () => {
    const quests = Object.keys(MANUAL_QUESTS).filter((id) => id !== '639dbaf17c898a131e1cffff').map((id) => quest(id, (MANUAL_QUESTS[id]!.fixes.flatMap((fix) => fix.objectives ?? [])).map((gameId) => ({ id: `text of ${gameId}`, gameId }))))
    const vitamins = quests.find((entry) => entry.id === '5b478eca86f7744642012254')!
    vitamins.objectiveDetails = []
    expect(unmatchedManualFixes(quests, 'pve')).toEqual([
      { questId: '5b478eca86f7744642012254', name: 'Витамины', date: '2026-11-10', objectiveId: '5b478f6886f774464201225a' },
      { questId: '5b478eca86f7744642012254', name: 'Витамины', date: '2026-11-23', objectiveId: '5b478f6886f774464201225a' },
      { questId: '639dbaf17c898a131e1cffff', name: 'Должник', date: '2026-11-08' },
    ])
  })
})
