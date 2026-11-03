// @vitest-environment node
import { constants } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { followGameFront, resetGamePriorityForTests } from './gamePriority'

beforeEach(() => resetGamePriorityForTests())

describe('the app gives way to the game', () => {
  it('runs below normal while the game is in front, normal again in its own window, set only on a change', () => {
    const set = vi.fn()
    followGameFront(false, set)
    followGameFront(true, set)
    followGameFront(true, set)
    followGameFront(false, set)
    expect(set.mock.calls).toEqual([[constants.priority.PRIORITY_NORMAL], [constants.priority.PRIORITY_BELOW_NORMAL], [constants.priority.PRIORITY_NORMAL]])
  })

  it('a priority Windows refuses is left as it is', () => {
    expect(() => followGameFront(true, () => { throw new Error('EACCES') })).not.toThrow()
  })
})
