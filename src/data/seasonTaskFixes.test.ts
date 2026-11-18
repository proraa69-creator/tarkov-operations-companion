import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { withSeasonTaskFixes } from './catalogSource'
import { applyQuestCorrections } from './questCorrections'

const VACATE = '67d03be712fb5f8fd2096332'
const OBJECTIVE = '67d03be712fb5f8fd2096334'
const ALTYN = '5aa7e276e5b5b000171d0647'

// tarkov.dev `pvp-season/tasks` as served on 18.11.2026 (the PvP version), cut to what the fix touches
const rawTask = () => ({
  id: VACATE,
  objectives: [{ id: OBJECTIVE, description: OBJECTIVE, type: 'shoot', count: 36, targetNames: ['Any'], maps: ['6733700029c367a3d40b02af'] }],
  finishRewards: { items: [{ item: '5449016a4bdc2d6f028b456f', count: 275000 }], offerUnlock: [{ id: '6a7076a84226bf182a0993fd', level: 4, item: ALTYN, trader: '5ac3b934156ae10c4430e83c' }] },
})
const translatedTask = () => ({
  ...rawTask(),
  objectives: [{ ...rawTask().objectives[0]!, id: 'Устранить любую цель в Лабиринте', description: 'Устранить любую цель в Лабиринте', targetNames: ['Любая локация'] }],
})
const dictionary = { [OBJECTIVE]: 'Устранить любую цель в Лабиринте', Any: 'Любая локация', AnyPmc: 'любых бойцов ЧВК' }

type Task = { objectives: Array<{ id: string; count: number; targetNames: string[]; description: string }>; finishRewards: { offerUnlock: unknown[]; items: unknown[] } }

describe('report 192: «Освободить помещение» in Season', () => {
  it('24 PMC operatives in the Labyrinth and no «Алтын» at Ragman, in both the translated and the raw data', () => {
    const raw = { data: { tasks: { [VACATE]: rawTask(), other: { id: 'other', objectives: [] } } }, dictionary }
    const tasks = withSeasonTaskFixes({ tasks: { [VACATE]: translatedTask(), other: { id: 'other' } } }, raw, 'ru') as { tasks: Record<string, Task> }
    const quest = tasks.tasks[VACATE]!
    expect(quest.objectives[0]).toMatchObject({ id: 'Устранить любую цель в Лабиринте', count: 24, targetNames: ['любых бойцов ЧВК'], description: 'Устранить бойцов ЧВК в Лабиринте' })
    expect(quest.finishRewards.offerUnlock).toEqual([])
    expect(quest.finishRewards.items).toHaveLength(1)
    const rawQuest = (raw.data as unknown as { tasks: Record<string, Task> }).tasks[VACATE]!
    expect(rawQuest.objectives[0]).toMatchObject({ id: OBJECTIVE, count: 24, targetNames: ['AnyPmc'], description: OBJECTIVE })
    expect(rawQuest.finishRewards.offerUnlock).toEqual([])
    expect(tasks.tasks.other).toEqual({ id: 'other' })
  })

  it('in English the game\'s wording', () => {
    const tasks = withSeasonTaskFixes({ tasks: { [VACATE]: translatedTask() } }, { data: { tasks: { [VACATE]: rawTask() } }, dictionary: { AnyPmc: 'any PMC operatives' } }, 'en') as { tasks: Record<string, Task> }
    expect(tasks.tasks[VACATE]!.objectives[0]).toMatchObject({ description: 'Eliminate PMC operatives inside The Labyrinth', targetNames: ['any PMC operatives'] })
  })

  it('without the quest, the data stays as it is', () => {
    const root = { tasks: { other: { id: 'other' } } }
    expect(withSeasonTaskFixes(root, { data: { tasks: {} } }, 'ru')).toBe(root)
  })

  it('the description says ЧВК in Season only', () => {
    const quest = { id: VACATE, name: 'Освободить помещение', trader: 'Барахольщик', level: 26, kappa: false, objectives: [], rewards: [],
      description: 'Вот если бы настоящий профессионал по периметру всё обошёл и лишних людей оттуда погонял, тогда бы дело пошло.' } as Quest
    expect(applyQuestCorrections([quest], 'ru', 'seasonal')[0]!.description).toContain('всё обошёл и ЧВК оттуда погонял')
    expect(applyQuestCorrections([quest], 'ru', 'pvp')[0]).toBe(quest)
    expect(applyQuestCorrections([quest], 'ru', 'pve')[0]).toBe(quest)
  })
})
