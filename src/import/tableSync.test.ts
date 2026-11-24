import { describe, expect, it } from 'vitest'
import type { ModeProgress, Quest, TableSyncState, TaskProgressRecord } from '../domain/types'
import { startTableVisit, TABLE_SYNC_MOST_VISITS, tableSyncAfterVisit, tableSyncOpen, withTableReading, type TableVisit } from './tableSync'

const NOW = '2026-11-04T15:00:00.000Z'
const quest = (id: string, kind?: Quest['kind']) => ({ id, name: id, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], ...(kind ? { kind } : {}) }) as Quest
const quests = [quest('a'), quest('b'), quest('c'), quest('d'), quest('story', 'story')]
const log = (taskId: string): TaskProgressRecord => ({ taskId, status: 'active', source: 'eft-log', updatedAt: NOW })
const mode = (tableSync?: TableSyncState, logged: string[] = [], table: string[] = []): Pick<ModeProgress, 'tableSync' | 'taskProgress' | 'questInputs'> => ({
  ...(tableSync ? { tableSync } : {}),
  taskProgress: Object.fromEntries(logged.map((taskId) => [taskId, log(taskId)])),
  questInputs: { log: {}, server: {}, manual: {}, story: {}, table: Object.fromEntries(table.map((taskId) => [taskId, log(taskId)])), legacy: {} } as unknown as ModeProgress['questInputs'],
})
function visit(ids: string[], readings = 2, tableBefore: string[] = []): TableVisit {
  let result: TableVisit = { ...startTableVisit('p', 'pve', undefined), tableBefore }
  for (let reading = 1; reading <= readings; reading += 1) result = withTableReading(result, ids, reading)
  return result
}
const sync = (visits: number, seen: string[] = []): TableSyncState => ({ startedAt: NOW, seen, visits })

describe('the first sync of the Tasks table', () => {
  it('stays open while the table was not read at all: a player may not open «Задания» for days', () => {
    expect(tableSyncOpen(undefined)).toBe(true)
    expect(tableSyncOpen(mode())).toBe(true)
    expect(tableSyncOpen(mode(sync(5)))).toBe(true)
    expect(tableSyncOpen(mode({ ...sync(2), doneAt: NOW }))).toBe(false)
    const before = mode(sync(0))
    expect(tableSyncAfterVisit(before, visit([], 0), quests, NOW)).toBe(before.tableSync)
  })

  it('a fresh reading naming a quest counts; a copy of the last one or a frame naming none does not', () => {
    const first = withTableReading(startTableVisit('p', 'pve', undefined), ['a'], 5)
    expect(first.readings).toBe(1)
    expect(withTableReading(first, ['b'], 5)).toBe(first)
    expect(withTableReading(first, [], 6)).toBe(first)
  })

  it('a glance is no visit: one reading counts for nothing but what it read', () => {
    const after = tableSyncAfterVisit(mode(sync(1), ['a']), visit(['a'], 1), quests, NOW)!
    expect(after).toMatchObject({ visits: 1, seen: ['a'] })
    expect(after.doneAt).toBeUndefined()
  })

  it('the whole list read twice ends it at once: it fits on a page', () => {
    expect(tableSyncAfterVisit(mode(), { ...visit(['a', 'b']), whole: true }, quests, NOW)).toMatchObject({ doneAt: NOW, seen: ['a', 'b'] })
  })

  it('the first visit never ends it by itself: only its first page may have been read', () => {
    expect(tableSyncAfterVisit(mode(undefined, ['a'], []), visit(['a']), quests, NOW)?.doneAt).toBeUndefined()
  })

  it('a later visit that adds nothing ends it when most of what the logs hold open was read', () => {
    const logged = ['a', 'b', 'c', 'd']
    expect(tableSyncAfterVisit(mode(sync(1, ['a', 'b', 'c']), logged), visit(['a', 'b']), quests, NOW)?.doneAt).toBe(NOW)
  })

  it('only the first page read again keeps it open: the logs hold more than that', () => {
    const logged = ['a', 'b', 'c', 'd']
    const after = tableSyncAfterVisit(mode(sync(1, ['a']), logged), visit(['a', 'b']), quests, NOW)!
    expect(after.doneAt).toBeUndefined()
    expect(after.visits).toBe(2)
  })

  it('story chapters and quests of no catalog do not count among what the logs hold open', () => {
    expect(tableSyncAfterVisit(mode(sync(1, ['a']), ['a', 'story', 'not-in-the-catalog']), visit(['a']), quests, NOW)?.doneAt).toBe(NOW)
  })

  it('a visit that added a quest keeps it open: more may come', () => {
    const after = tableSyncAfterVisit(mode(sync(1, ['a']), ['a'], ['a', 'new']), visit(['a', 'new'], 2, ['a']), quests, NOW)!
    expect(after.doneAt).toBeUndefined()
    expect(tableSyncAfterVisit(mode(after, ['a'], ['a', 'new']), visit(['a', 'new'], 2, ['a', 'new']), quests, NOW)?.doneAt).toBe(NOW)
  })

  it('no quest in the logs: nothing to tell the list by, the second visit that adds nothing ends it', () => {
    expect(tableSyncAfterVisit(mode(sync(1, ['a']), [], ['a']), visit(['a'], 2, ['a']), quests, NOW)?.doneAt).toBe(NOW)
  })

  it('ends after so many visits, whatever they showed: logs holding quests the game no longer lists never get there', () => {
    const logged = ['a', 'b', 'c', 'd']
    expect(tableSyncAfterVisit(mode(sync(TABLE_SYNC_MOST_VISITS - 2, ['a']), logged), visit(['a']), quests, NOW)?.doneAt).toBeUndefined()
    expect(tableSyncAfterVisit(mode(sync(TABLE_SYNC_MOST_VISITS - 1, ['a']), logged), visit(['a']), quests, NOW)?.doneAt).toBe(NOW)
  })

  it('once ended, nothing changes it', () => {
    const done = mode({ ...sync(3), doneAt: NOW })
    expect(tableSyncAfterVisit(done, { ...visit(['a']), whole: true }, quests, '2026-11-05T00:00:00.000Z')).toBe(done.tableSync)
  })
})
