import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { followUpQuests, prerequisiteIds, sortQuestsChronologically } from './questChronology'

const quest = (id: string, level: number, previous: string[] = [], trader = 'Прапор'): Quest => ({
  id, name: id, trader, level, kappa: false, description: '', objectives: [], rewards: [], previous,
})

describe('sortQuestsChronologically', () => {
  it('puts every quest after the quests it requires, lower levels first', () => {
    const quests = [quest('c', 1, ['b']), quest('late', 20), quest('b', 5, ['a']), quest('a', 1), quest('side', 3)]
    expect(sortQuestsChronologically(quests).map((entry) => entry.id)).toEqual(['a', 'side', 'b', 'c', 'late'])
  })

  it('respects prerequisites of another trader that are not in the list', () => {
    const other = quest('other', 15, [], 'Терапевт')
    const own = [quest('needs-other', 2, ['other']), quest('plain', 10)]
    expect(sortQuestsChronologically(own, [...own, other]).map((entry) => entry.id)).toEqual(['plain', 'needs-other'])
  })

  it('survives a cyclic chain', () => {
    const quests = [quest('x', 1, ['y']), quest('y', 1, ['x'])]
    expect(sortQuestsChronologically(quests)).toHaveLength(2)
  })
})

describe('prerequisites and follow-ups', () => {
  it('prefers explicit requirements over previous ids', () => {
    const entry = { ...quest('q', 1, ['old']), requirements: [{ taskId: 'new', allowedStatuses: ['complete' as const] }] }
    expect(prerequisiteIds(entry)).toEqual(['new'])
  })

  it('finds the quests a quest unlocks', () => {
    const quests = [quest('a', 1), quest('b', 2, ['a']), quest('c', 2, ['a']), quest('d', 3, ['b'])]
    expect(followUpQuests(quests[0], quests).map((entry) => entry.id)).toEqual(['b', 'c'])
  })
})
