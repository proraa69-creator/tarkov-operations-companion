import { describe, expect, it } from 'vitest'
import type { AppDataset, Quest } from '../domain/types'
import { helpViewOf, questGridHistory, snapshotUnlock, withQuestGrid } from './questGrid'

const THERAPIST = '54cb57776803fa99248b456e'
// json.tarkov.dev task ids (the snapshot of src/data/questGrid.snapshot.json)
const SHORTAGE = '5967733e86f774602332fc84' // «Дефицит»: Therapist's first line, level 1
const FALL_AILMENT = '6a5424ae135497b9df0c68be' // «Осеннее недомогание»: the same line, level 4
const FIRST_IN_LINE = '657315ddab5a49b71f098853' // «Первый в очереди»: given in a dialogue

const quest = (id: string, extra: Partial<Quest> = {}): Quest => ({ id, name: id, trader: 'Терапевт', level: 1, kappa: false, description: '', objectives: [], rewards: [], ...extra })
const dataset = (quests: Quest[]) => ({ quests, traders: [{ id: THERAPIST, name: 'Терапевт' }] }) as unknown as AppDataset

describe('the quest grid snapshot', () => {
  it("knows Therapist's first line level by level and his dialogue quests in every mode", () => {
    for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
      expect(snapshotUnlock(mode, SHORTAGE)?.lines?.[0].level).toBe(1)
      expect(snapshotUnlock(mode, FALL_AILMENT)?.lines?.[0]).toEqual({ id: snapshotUnlock(mode, SHORTAGE)!.lines![0].id, level: 4 })
      expect(snapshotUnlock(mode, FIRST_IN_LINE)).toEqual({ dialogue: true })
    }
    expect(snapshotUnlock('pve', 'not-a-task')).toBeUndefined()
  })

  it("keeps tarkov.help's view and the quests the game no longer has", () => {
    expect(helpViewOf(SHORTAGE)).toMatchObject({ ll: 1 })
    expect(questGridHistory.some((entry) => entry.name === 'Сетевой провайдер. Часть 1')).toBe(true)
  })

  it("gives the catalog's quests their trader, lines in the trader's order and tarkov.help's view, keeping the catalog's own lines", () => {
    const own = { lines: [{ id: 'catalog-line', level: 3 }] }
    const { quests } = withQuestGrid(dataset([quest(SHORTAGE), quest(FALL_AILMENT), quest('own', { unlock: own })]), 'pve')
    const shortage = quests.find((entry) => entry.id === SHORTAGE)!
    expect(shortage.traderId).toBe(THERAPIST)
    expect(shortage.unlock?.lines?.[0]).toMatchObject({ level: 1, order: 1, ll: 1 })
    expect(shortage.helpView?.ll).toBe(1)
    // a line the snapshot does not know comes after the known ones
    expect(quests.find((entry) => entry.id === 'own')!.unlock?.lines?.[0]).toMatchObject({ id: 'catalog-line', level: 3, order: 2 })
  })
})
