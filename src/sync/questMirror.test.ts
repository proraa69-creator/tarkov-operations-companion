import { beforeEach, describe, expect, it } from 'vitest'
import type { LocalProfile, ModeProgress, TaskProgressRecord } from '../domain/types'
import { createLocalProfile } from '../domain/progress'
import { holdQuestMirror, mirroredTaskProgress, noteQuestMirrorAccount, parseQuestMirror, questMirrorBody, withQuestMirrors } from './questMirror'

const record = (taskId: string, status: TaskProgressRecord['status'], updatedAt = '2026-10-18T09:00:00.000Z'): TaskProgressRecord => ({ taskId, status, source: 'eft-log', updatedAt })

describe('quest mirror (the PC\'s quests on the phone)', () => {
  beforeEach(() => { localStorage.clear(); noteQuestMirrorAccount('nobody') })

  it('sends the PC records as they are, with times in UTC and bad rows left out', () => {
    const body = questMirrorBody({ taskProgress: {
      q1: record('q1', 'completed', '2026-10-18T12:00:00+03:00'),
      story: { ...record('story', 'active'), source: 'screen-scan', currentStageIndex: 2, storyObjectives: [{ id: 'o1', text: 'Найти', optional: false, completed: true }] },
      bad: { ...record('bad', 'active'), status: 'done' as TaskProgressRecord['status'] },
      '<x>': record('<x>', 'active'),
    }, playerLevel: 39, faction: 'bear', prestige: 1, trackedTaskIds: ['q1', '<x>'] }, '2026-10-18T10:00:00.000Z')
    expect(body.profile).toEqual({ playerLevel: 39, faction: 'bear', prestige: 1, trackedTaskIds: ['q1'] })
    expect(Object.keys(body.records).sort()).toEqual(['q1', 'story'])
    expect(body.records.q1.updatedAt).toBe('2026-10-18T09:00:00.000Z')
    expect(body.records.story.storyObjectives).toHaveLength(1)
    expect(parseQuestMirror(body)).toEqual(body)
    expect(parseQuestMirror({ at: 'never', records: {} })).toBeNull()
  })

  it('shows the PC copy instead of the phone records; the phone marks made after it go on top', () => {
    const progress = {
      taskProgress: { q1: record('q1', 'active'), q9: record('q9', 'active') },
      questInputs: { log: {}, server: {}, table: {}, story: {}, legacy: {}, manual: { q2: { status: 'completed', at: '2026-10-18T11:00:00.000Z' }, q1: { status: 'active', at: '2026-10-18T08:00:00.000Z' } } },
    } as Pick<ModeProgress, 'taskProgress' | 'questInputs'>
    const mirror = { at: '2026-10-18T10:00:00.000Z', records: { q1: record('q1', 'completed') } }
    const shown = mirroredTaskProgress(progress, mirror)
    expect(shown.q1.status).toBe('completed')
    expect(shown.q9).toBeUndefined()
    expect(shown.q2).toMatchObject({ status: 'completed', source: 'manual-fix' })
    expect(mirroredTaskProgress(progress, null)).toBe(progress.taskProgress)
  })

  it('holds copies per account and drops them for another account', () => {
    const profile: LocalProfile = createLocalProfile('Оператор', 'p1')
    holdQuestMirror('a', 'pvp', { at: '2026-10-18T10:00:00.000Z', records: { q1: record('q1', 'completed') }, profile: { playerLevel: 39, trackedTaskIds: ['q1'] } })
    const stored = JSON.parse(localStorage.getItem('raidos-quest-mirror-v1') ?? '{}') as { account: string; mirrors: Record<string, unknown> }
    expect(stored.account).toBe('a')
    const shown = withQuestMirrors(profile, stored.mirrors as Parameters<typeof withQuestMirrors>[1])
    expect(shown.modes.pvp.taskProgress.q1.status).toBe('completed')
    expect(shown.modes.pvp.playerLevel).toBe(39)
    expect(shown.modes.pvp.trackedTaskIds).toEqual(['q1'])
    expect(shown.modes.pve).toBe(profile.modes.pve)
    noteQuestMirrorAccount('b')
    expect(localStorage.getItem('raidos-quest-mirror-v1')).toBeNull()
  })
})
