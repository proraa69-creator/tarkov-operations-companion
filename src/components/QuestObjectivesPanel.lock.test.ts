import { describe, expect, it } from 'vitest'
import type { ObjectiveView } from '../progression/objectiveProgress'
import { lockedDone } from './QuestObjectivesPanel'

const view = (type: string, done: boolean) => ({ def: { id: 'o', taskId: 'q', type, description: '', target: 1, optional: false, stableId: true }, current: done ? 1 : 0, done, derived: false }) as ObjectiveView

describe('ticks that cannot be undone', () => {
  it('a planted or marked objective, once ticked, stays ticked; others can be unticked', () => {
    expect(lockedDone(view('plantItem', true))).toBe(true)
    expect(lockedDone(view('plantQuestItem', true))).toBe(true)
    expect(lockedDone(view('mark', true))).toBe(true)
    expect(lockedDone(view('mark', false))).toBe(false)
    expect(lockedDone(view('visit', true))).toBe(false)
  })
})
