import { describe, expect, it } from 'vitest'
import type { RaidMode } from '../domain/types'
import { BOREAS_RAGMAN, PAY_THE_FARE_ID, withCuratedTasks } from './curatedQuests'
import { unlockFromRequirements } from './questUnlock'

const RAGMAN = '5ac3b934156ae10c4430e83c'
const SUDAK_TUDAK = '6a8c4c7999baf8bd5802f7fe'
type Objective = { id: string; type: string; description: string; items?: string[]; foundInRaid?: boolean; zones: unknown[] }
type Task = { name: string; trader: string; experience: number; taskRequirements: unknown[]; otherRequirements: Array<{ type: string }>; objectives: Objective[]; finishRewards: { items: Array<{ item: string; count: number }> } }
const task = (mode: RaidMode = 'pvp', locale: 'ru' | 'en' = 'ru') => {
  const built = withCuratedTasks({ tasks: {} }, { mode, locale, maps: {}, traders: { [RAGMAN]: { id: RAGMAN } }, series: [BOREAS_RAGMAN] })
  return (built.tasks.tasks as Record<string, Task>)[PAY_THE_FARE_ID]
}

describe('«За проезд передаём!» (Ragman): the live quest the feed lacks', () => {
  for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
    it(`${mode}: there in both languages, three tools found in raid and handed over`, () => {
      const ru = task(mode)
      const en = task(mode, 'en')
      expect(ru.name).toBe('За проезд передаём!')
      expect(en.name).toBe('Pay the Fare!')
      expect(ru.trader).toBe(RAGMAN)
      expect(ru.experience).toBe(30_000)
      expect(ru.objectives.map((objective) => objective.type)).toEqual(['findItem', 'giveItem', 'findItem', 'giveItem', 'findItem', 'giveItem'])
      expect(ru.objectives.every((objective) => objective.foundInRaid === true && objective.items?.length === 1 && objective.zones.length === 0)).toBe(true)
      expect(en.objectives.every((objective) => !/[а-яё]/i.test(objective.description))).toBe(true)
    })
  }

  it('10 kits in PvE, 5 elsewhere', () => {
    const kits = (mode: RaidMode) => task(mode).finishRewards.items
    expect(kits('pvp')).toEqual([{ item: SUDAK_TUDAK, count: 5, attributes: {} }])
    expect(kits('seasonal')).toEqual([{ item: SUDAK_TUDAK, count: 5, attributes: {} }])
    expect(kits('pve')).toEqual([{ item: SUDAK_TUDAK, count: 10, attributes: {} }])
  })

  it('opens at a stage of a story chapter: no quest before it, a condition the game checks', () => {
    const { taskRequirements, otherRequirements } = task()
    expect(taskRequirements).toEqual([])
    expect(otherRequirements).toEqual([{ type: 'storyStage' }])
    expect(BOREAS_RAGMAN.quests[0].dialogue).toBeUndefined()
    // not a trader's line or a talk: those would count it among the trader's first quests
    expect(unlockFromRequirements(otherRequirements)).toBeUndefined()
  })
})
