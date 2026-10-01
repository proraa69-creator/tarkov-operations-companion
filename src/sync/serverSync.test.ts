import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModeRegistration } from '../domain/types'
import type { ModeLogScanResult } from '../import/eftLogTimeline'
import { isCollectorDirty, loadCollected, saveCollected } from '../kappa/collector'
import { createModeProgress } from '../domain/progress'
import { applyObjectiveChange, mergeRemoteObjectives } from '../progression/objectiveProgress'
import { bindObjectiveSync, createPositionThrottle, objectiveSyncPayload, parseObjectiveSnapshot, parseServerRecords, pushLogProgress, refreshServerStatus, serverEventsForMode, syncCollector, syncObjectives } from './serverSync'

const TASK = '5936d90786f7742b1420ba5b'
const CHARACTER = '0123456789abcdef01234567'
const unregistered: ModeRegistration = { status: 'unregistered' } as ModeRegistration

function scan(): ModeLogScanResult {
  const events = [
    { taskId: TASK, status: 'completed' as const, timestamp: '2026-09-25T12:00:00.000Z', mode: 'pve' as const, accountId: 7 },
    { taskId: 'not-a-log-id', status: 'active' as const, timestamp: '2026-09-25T12:00:00.000Z', mode: 'pve' as const },
  ]
  return {
    events, detectedModes: ['pve'], accountIds: [7], profileIds: [CHARACTER], ignoredRecords: 0, unresolvedEvents: 0, sessionCount: 1,
    eventsByMode: { pvp: [], pve: events, seasonal: [] },
    summaryByMode: { pve: { lastActivityAt: '2026-09-25T12:00:00.000Z', questCount: 1 } } as unknown as ModeLogScanResult['summaryByMode'],
    latestAccountIdByMode: { pve: 7 }, latestCharacterIdByMode: { pve: CHARACTER },
  }
}

describe('server sync helpers', () => {
  it('sends only server-valid log events of one mode', () => {
    expect(serverEventsForMode(scan(), 'pve', unregistered)).toEqual([{ taskId: TASK, status: 'completed', timestamp: '2026-09-25T12:00:00.000Z' }])
    expect(serverEventsForMode(scan(), 'pvp', unregistered)).toEqual([])
  })

  it('validates server records', () => {
    expect(parseServerRecords(null)).toBeNull()
    expect(parseServerRecords({ records: [{ taskId: TASK, status: 'active', updatedAt: '2026-09-25T10:00:00.000Z' }, { taskId: 'x', status: 'active', updatedAt: 'y' }] }))
      .toEqual([{ taskId: TASK, status: 'active', timestamp: '2026-09-25T10:00:00.000Z' }])
  })

  it('throttles positions to one per interval and keeps the newest', () => {
    vi.useFakeTimers()
    try {
      let clock = 10_000
      const sent: number[] = []
      const throttle = createPositionThrottle((position) => sent.push(position.x), 2000, () => clock)
      const at = (x: number) => ({ x, y: 0, z: 0, yaw: 0, at: clock })
      throttle.push(at(1))
      clock += 500; throttle.push(at(2))
      clock += 500; throttle.push(at(3))
      expect(sent).toEqual([1])
      clock += 1000; vi.advanceTimersByTime(1500)
      expect(sent).toEqual([1, 3])
      throttle.cancel()
    } finally { vi.useRealTimers() }
  })
})

describe('server sync with the desktop gateway', () => {
  const serviceRequest = vi.fn()
  const status = vi.fn()

  beforeEach(async () => {
    localStorage.clear()
    serviceRequest.mockReset()
    status.mockReset()
    status.mockResolvedValue({ signedIn: true, email: 'a@example.com', kind: 'user', online: true, serverUrl: 'http://127.0.0.1:8787', persistent: true })
    Object.assign(window, { tarkovDesktop: { serviceRequest, account: { status, login: vi.fn(), logout: vi.fn(), openWebsite: vi.fn() } } })
    await refreshServerStatus()
  })
  afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop') })

  it('pushes offline Collector edits first, then pulls the server copy', async () => {
    saveCollected('pvp', ['axe'])
    expect(isCollectorDirty('pvp')).toBe(true)
    serviceRequest.mockResolvedValueOnce({ itemIds: ['axe'], updatedAt: 'now' })
    await syncCollector('pvp')
    expect(serviceRequest).toHaveBeenCalledWith('PUT', '/v1/me/collector/pvp', { itemIds: ['axe'] })
    expect(isCollectorDirty('pvp')).toBe(false)

    serviceRequest.mockResolvedValueOnce({ itemIds: ['axe', 'book'], updatedAt: 'later' })
    await syncCollector('pvp')
    expect(serviceRequest).toHaveBeenLastCalledWith('GET', '/v1/me/collector/pvp', undefined)
    expect(loadCollected('pvp')).toEqual(['axe', 'book'])
    expect(isCollectorDirty('pvp')).toBe(false)
    expect(loadCollected('pve')).toEqual([])
  })

  it('keeps the local checklist when the server is down', async () => {
    saveCollected('pve', ['axe'])
    serviceRequest.mockRejectedValue(new Error("Error invoking remote method 'service:request': Error: Сервер недоступен"))
    await syncCollector('pve')
    expect(loadCollected('pve')).toEqual(['axe'])
    expect(isCollectorDirty('pve')).toBe(true)
  })

  it('sends log events per mode and applies the merged server records back', async () => {
    serviceRequest.mockResolvedValue({ records: [{ taskId: TASK, status: 'completed', updatedAt: '2026-09-25T12:00:00.000Z', source: 'eft-log' }, { taskId: '5936d90786f7742b1420ba5c', status: 'active', updatedAt: '2026-09-20T12:00:00.000Z', source: 'eft-log' }] })
    const apply = vi.fn()
    await pushLogProgress(scan(), () => unregistered, apply)
    expect(serviceRequest).toHaveBeenCalledTimes(1)
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/me/progress/pve/events', { accountId: 7, characterId: CHARACTER, events: [{ taskId: TASK, status: 'completed', timestamp: '2026-09-25T12:00:00.000Z' }] })
    expect(apply).toHaveBeenCalledWith('pve', expect.arrayContaining([expect.objectContaining({ taskId: '5936d90786f7742b1420ba5c', status: 'active' })]), CHARACTER)
  })

  it('pushes objective progress and unconfirmed events, then merges the server copy (marking echoes synced)', async () => {
    let progress = applyObjectiveChange(createModeProgress(), 'pve', { objectiveId: 'obj-1', taskId: TASK, type: 'shoot', target: 5, current: 3, source: 'manual', confidence: 1, observedAt: '2026-09-25T10:00:00.000Z' }, { eventId: 'ev-local-1' }).progress
    // A wiki id the server would reject stays local instead of failing the batch.
    progress = applyObjectiveChange(progress, 'pve', { objectiveId: 'obj-2', taskId: 'wiki:Задание (старое)', type: 'unknown', target: 1, current: 1, source: 'manual', confidence: 1, observedAt: '2026-09-25T10:00:00.000Z' }, { eventId: 'ev-local-2' }).progress
    const payload = objectiveSyncPayload(progress)
    expect(payload.objectives.map((entry) => entry.objectiveId)).toEqual(['obj-1'])
    expect(payload.events.map((entry) => entry.id)).toEqual(['ev-local-1'])
    expect(payload.events[0]).not.toHaveProperty('mode')

    const serverObjective = { objectiveId: 'obj-3', taskId: TASK, type: 'visit', target: 1, current: 1, source: 'manual', confidence: 1, observedAt: '2026-09-25T11:00:00.000Z', completedAt: '2026-09-25T11:00:00.000Z' }
    serviceRequest.mockResolvedValue({
      objectives: [payload.objectives[0], serverObjective, { objectiveId: 'bad', current: 'x' }],
      events: [{ ...payload.events[0] }, { id: 'ev-phone-1', taskId: TASK, objectiveId: 'obj-3', eventType: 'objective', oldValue: null, newValue: 1, source: 'manual', confidence: 1, observedAt: '2026-09-25T11:00:00.000Z', reversible: false }],
      updatedAt: '2026-09-25T11:00:00.000Z',
    })
    bindObjectiveSync({ read: () => progress, apply: (_mode, remote) => { progress = mergeRemoteObjectives(progress, remote) } })
    try {
      await syncObjectives('pve')
    } finally { bindObjectiveSync(null) }
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/me/objectives/pve/sync', payload)
    expect(Object.keys(progress.objectiveProgress).sort()).toEqual(['obj-1', 'obj-2', 'obj-3'])
    expect(progress.progressEvents.map((event) => [event.id, Boolean(event.synced)])).toEqual([['ev-local-1', true], ['ev-local-2', false], ['ev-phone-1', true]])
    // Nothing left to send: ev-local-1 is confirmed, ev-local-2 cannot go to the server.
    expect(objectiveSyncPayload(progress).events).toEqual([])
    expect(parseObjectiveSnapshot({ objectives: 'x', events: [] }, 'pve')).toBeNull()
  })

  it('does nothing while signed out', async () => {
    status.mockResolvedValue({ signedIn: false, online: true, serverUrl: 'http://127.0.0.1:8787', persistent: true })
    await refreshServerStatus()
    const apply = vi.fn()
    await pushLogProgress(scan(), () => unregistered, apply)
    await syncCollector('pvp')
    expect(serviceRequest).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })
})
