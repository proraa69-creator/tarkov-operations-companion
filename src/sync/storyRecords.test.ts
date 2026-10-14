import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { Quest } from '../domain/types'
import { parseStoryAnswer, storyProgressRecords, storyRecordsOf } from './storyRecords'

const chapter = (id: string, stages: string[]) => ({ id, kind: 'story', stages: stages.map((stage) => ({ id: stage })) } as unknown as Quest)
const QUESTS = [
  chapter('story-tour', ['story-tour-0', 'story-tour-1', 'story-tour-2']),
  chapter('story-batya', ['story-batya-0']),
  { id: '5936d90786f7742b1420ba5b', kind: 'trader' } as Quest,
]

describe('story chapters through the server (P9)', () => {
  it('sends the catalog\'s chapters this PC read: status, stage id and time', () => {
    const progress = createModeProgress()
    progress.taskProgress = {
      'story-tour': { taskId: 'story-tour', status: 'active', source: 'screen-scan', updatedAt: '2026-10-01T10:00:00Z', currentStageIndex: 2, storyObjectives: [] },
      'story-batya': { taskId: 'story-batya', status: 'completed', source: 'screen-scan', updatedAt: '2026-10-02T10:00:00.000Z' },
      '5936d90786f7742b1420ba5b': { taskId: '5936d90786f7742b1420ba5b', status: 'active', source: 'eft-log', updatedAt: '2026-10-02T10:00:00.000Z' },
      'story-unknown': { taskId: 'story-unknown', status: 'active', source: 'screen-scan', updatedAt: '2026-10-02T10:00:00.000Z', currentStageIndex: 0 },
    }
    expect(storyRecordsOf(progress, QUESTS)).toEqual([
      { chapterId: 'story-tour', status: 'active', stageId: 'story-tour-2', updatedAt: '2026-10-01T10:00:00.000Z' },
      { chapterId: 'story-batya', status: 'completed', updatedAt: '2026-10-02T10:00:00.000Z' },
    ])
  })

  it('takes the server\'s chapters the catalog knows, the stage by its id', () => {
    expect(storyProgressRecords([
      { chapterId: 'story-tour', status: 'active', stageId: 'story-tour-1', updatedAt: '2026-10-01T10:00:00.000Z' },
      { chapterId: 'story-batya', status: 'active', stageId: 'story-batya-9', updatedAt: '2026-10-01T10:00:00.000Z' },
      { chapterId: 'story-gone', status: 'active', updatedAt: '2026-10-01T10:00:00.000Z' },
    ], QUESTS)).toEqual([
      { taskId: 'story-tour', status: 'active', updatedAt: '2026-10-01T10:00:00.000Z', currentStageIndex: 1 },
      { taskId: 'story-batya', status: 'active', updatedAt: '2026-10-01T10:00:00.000Z' },
    ])
  })

  it('trusts nothing in the answer it cannot check', () => {
    expect(parseStoryAnswer({ characterId: null, records: [] })).toBeNull()
    expect(parseStoryAnswer({ characterId: '0123456789abcdef01234567', records: [
      { chapterId: 'story-tour', status: 'completed', updatedAt: '2026-10-01T10:00:00Z' },
      { chapterId: '<script>', status: 'active', updatedAt: '2026-10-01T10:00:00Z' },
      { chapterId: 'story-batya', status: 'failed', updatedAt: '2026-10-01T10:00:00Z' },
      { chapterId: 'story-batya', status: 'active', updatedAt: 'yesterday' },
    ] })).toEqual({ characterId: '0123456789abcdef01234567', records: [{ chapterId: 'story-tour', status: 'completed', updatedAt: '2026-10-01T10:00:00.000Z' }] })
  })
})
