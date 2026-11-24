// @vitest-environment node
import { constants } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { followGameFront, resetGamePriorityForTests } from './gamePriority'

beforeEach(() => resetGamePriorityForTests())

const { PRIORITY_NORMAL: NORMAL, PRIORITY_BELOW_NORMAL: BELOW } = constants.priority

describe('the app gives way to the game', () => {
  it('runs below normal while the game is in front, normal again in its own window, set only on a change', () => {
    const set = vi.fn()
    followGameFront(false, set)
    followGameFront(true, set)
    followGameFront(true, set)
    followGameFront(false, set)
    expect(set.mock.calls).toEqual([[NORMAL, process.pid], [BELOW, process.pid], [NORMAL, process.pid]])
  })

  it('a priority Windows refuses is left as it is', () => {
    expect(() => followGameFront(true, () => { throw new Error('EACCES') })).not.toThrow()
  })

  it('report 227: every process of the app gives way, the main one once, one refusing leaves the others set', () => {
    const set = vi.fn((_priority: number, pid: number) => { if (pid === 2) throw new Error('ESRCH') })
    followGameFront(true, set, () => [process.pid, 2, 3])
    expect(set.mock.calls).toEqual([[BELOW, process.pid], [BELOW, 2], [BELOW, 3]])
  })

  it('the process list failing still sets the main process', () => {
    const set = vi.fn()
    followGameFront(true, set, () => { throw new Error('not ready') })
    expect(set.mock.calls).toEqual([[BELOW, process.pid]])
  })
})
