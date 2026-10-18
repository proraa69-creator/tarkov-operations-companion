import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Manual objectives are archived in the app; one test turns them on to check their sync still works when they return. */
const archived = vi.hoisted(() => ({ manualObjectives: true }))
vi.mock('../app/archivedFeatures', async (importOriginal) => {
  const original = await importOriginal<typeof import('../app/archivedFeatures')>()
  return { ...original, featureEnabled: (feature: Parameters<typeof original.featureEnabled>[0]) => feature === 'manualObjectives' ? !archived.manualObjectives : original.featureEnabled(feature) }
})
import type { ModeRegistration } from '../domain/types'
import type { ModeLogScanResult } from '../import/eftLogTimeline'
import type { StoryRecord } from './storyRecords'
import { isCollectorDirty, loadCollected, saveCollected } from '../kappa/collector'
import { createModeProgress } from '../domain/progress'
import { applyObjectiveChange, mergeRemoteObjectives } from '../progression/objectiveProgress'
import { bindManualSync, bindQuestMirrorSource, pullQuestMirror, pushQuestMirror, parseManualMarks, syncManualMarks, bindObjectiveSync, bindStorySync, createPositionThrottle, forgetProgressSync, modeResetFloor, queueModeReset, sendModeResets, syncStory, noteDesktopLogsMissing, objectiveSyncPayload, parseObjectiveSnapshot, parseServerRecords, parseServerScope, pullServerProgress, pushLogProgress, pullsServerProgress, refreshServerStatus, serverEventsForMode, syncCollector, syncObjectives } from './serverSync'

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
    forgetProgressSync()
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
    expect(apply).toHaveBeenCalledWith('pve', expect.arrayContaining([expect.objectContaining({ taskId: '5936d90786f7742b1420ba5c', status: 'active' })]), CHARACTER, undefined)
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
    archived.manualObjectives = false
    try {
      await syncObjectives('pve')
    } finally { bindObjectiveSync(null); archived.manualObjectives = true }
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/me/objectives/pve/sync', payload)
    expect(Object.keys(progress.objectiveProgress).sort()).toEqual(['obj-1', 'obj-2', 'obj-3'])
    expect(progress.progressEvents.map((event) => [event.id, Boolean(event.synced)])).toEqual([['ev-local-1', true], ['ev-local-2', false], ['ev-phone-1', true]])
    // Nothing left to send: ev-local-1 is confirmed, ev-local-2 cannot go to the server.
    expect(objectiveSyncPayload(progress).events).toEqual([])
    expect(parseObjectiveSnapshot({ objectives: 'x', events: [] }, 'pve')).toBeNull()
  })

  describe('the reset of a mode goes only to the account it was made under', () => {
    const SERVER = 'http://127.0.0.1:8787'
    const signIn = async (email: string | null, online = true) => {
      status.mockResolvedValue(email ? { signedIn: true, email, kind: 'user', online, serverUrl: SERVER, persistent: true } : { signedIn: false, online, serverUrl: SERVER, persistent: true })
      await refreshServerStatus()
    }
    const queue = () => JSON.parse(localStorage.getItem('raidos-mode-resets-v1') ?? '{}') as Record<string, Record<string, { at: string; pending?: boolean }>>
    const resetCalls = () => serviceRequest.mock.calls.filter(([, path]) => String(path).endsWith('/reset'))

    it('the same account: sent at once, then not again; then every log event goes again (no floor at the press)', async () => {
      const at = '2026-09-25T12:30:00.000Z'
      serviceRequest.mockResolvedValue({ resetAt: at, scope: { characterId: CHARACTER, accountId: 7, syncedAt: 'x', resetAt: at } })
      queueModeReset('pve', at)
      await vi.waitFor(() => expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/me/progress/pve/reset', { at }))
      await vi.waitFor(() => expect(queue()).toEqual({ [`${SERVER}|e:a@example.com`]: { pve: { at } } }))
      expect(modeResetFloor('pve')).toBe(at)
      expect(modeResetFloor('pvp')).toBeUndefined()
      await sendModeResets()
      expect(resetCalls()).toHaveLength(1)

      serviceRequest.mockReset()
      serviceRequest.mockResolvedValue({ records: [], scope: { characterId: CHARACTER, accountId: 7, syncedAt: 'x' } })
      await pushLogProgress(scan(), () => unregistered, vi.fn())
      // The event from before the press goes too, and no reset rides along: the press is no floor.
      expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/me/progress/pve/events', { accountId: 7, characterId: CHARACTER, events: [{ taskId: TASK, status: 'completed', timestamp: '2026-09-25T12:00:00.000Z' }] })
    })

    it('queued offline for one account: another account signing in gets nothing; the original account gets it when back', async () => {
      const at = '2026-09-25T13:00:00.000Z'
      await signIn('a@example.com', false)
      queueModeReset('seasonal', at)
      await sendModeResets()
      expect(resetCalls()).toEqual([])
      expect(queue()[`${SERVER}|e:a@example.com`]).toEqual({ seasonal: { at, pending: true } })

      // Another account on this PC: no reset request, no reset in its log pushes, nothing kept for it.
      await signIn('b@example.com')
      serviceRequest.mockResolvedValue({ records: [], scope: { characterId: CHARACTER, accountId: 7, syncedAt: 'x' } })
      await sendModeResets()
      expect(modeResetFloor('seasonal')).toBeUndefined()
      const scanSeasonal = { ...scan(), eventsByMode: { pvp: [], pve: [], seasonal: scan().eventsByMode.pve }, summaryByMode: { seasonal: { lastActivityAt: '2026-09-25T12:00:00.000Z', questCount: 1 } } as unknown as ModeLogScanResult['summaryByMode'], latestCharacterIdByMode: { seasonal: CHARACTER }, latestAccountIdByMode: { seasonal: 7 } }
      await pushLogProgress(scanSeasonal, () => unregistered, vi.fn())
      expect(resetCalls()).toEqual([])
      const push = serviceRequest.mock.calls.find(([, path]) => path === '/v1/me/progress/seasonal/events')
      expect(push?.[2]).not.toHaveProperty('resetAt')
      expect(queue()[`${SERVER}|e:b@example.com`]).toBeUndefined()
      expect(queue()[`${SERVER}|e:a@example.com`]).toEqual({ seasonal: { at, pending: true } })

      // The original account signs back in. While its reset waits, its Collector list is not pulled (the server's is the
      // one from before the reset); then the reset is sent, to it.
      serviceRequest.mockReset()
      serviceRequest.mockResolvedValue({ resetAt: at, scope: null })
      await signIn('A@Example.com')
      await syncCollector('seasonal')
      expect(serviceRequest).not.toHaveBeenCalled()
      await sendModeResets()
      expect(resetCalls()).toEqual([['POST', '/v1/me/progress/seasonal/reset', { at }]])
      expect(queue()[`${SERVER}|e:a@example.com`]).toEqual({ seasonal: { at } })
    })

    it('a reset made signed out stays local: never sent, to no account', async () => {
      await signIn(null)
      queueModeReset('pvp', '2026-09-25T14:00:00.000Z')
      expect(queue()).toEqual({})
      await signIn('a@example.com')
      await sendModeResets()
      await signIn('b@example.com')
      await sendModeResets()
      expect(resetCalls()).toEqual([])
      expect(modeResetFloor('pvp')).toBeUndefined()
    })

    it('an account the status does not tell apart (no e-mail, no phone) queues nothing', async () => {
      status.mockResolvedValue({ signedIn: true, online: true, serverUrl: SERVER, persistent: true })
      await refreshServerStatus()
      queueModeReset('pve', '2026-09-25T15:00:00.000Z')
      await sendModeResets()
      expect(resetCalls()).toEqual([])
      expect(queue()).toEqual({})
    })
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

  it('sends the objectives ticked by hand, but no quest status events of the logs while counters are archived (P21)', async () => {
    let progress = applyObjectiveChange(createModeProgress(), 'pve', { objectiveId: 'obj-1', taskId: TASK, type: 'shoot', target: 5, current: 5, source: 'manual', confidence: 1, observedAt: '2026-09-25T10:00:00.000Z' }, { eventId: 'ev-local-1' }).progress
    progress = { ...progress, progressEvents: [...progress.progressEvents, { id: 'ev-status-1', mode: 'pve', taskId: TASK, eventType: 'task-status', oldValue: null, newValue: 'active', source: 'log', confidence: 0.95, observedAt: '2026-09-25T09:00:00.000Z', reversible: true, synced: false }] }
    serviceRequest.mockResolvedValue({ objectives: [], events: [] })
    bindObjectiveSync({ read: () => progress, apply: (_mode, remote) => { progress = mergeRemoteObjectives(progress, remote) } })
    try {
      await syncObjectives('pve')
    } finally { bindObjectiveSync(null) }
    expect(serviceRequest).toHaveBeenCalledTimes(1)
    const [method, path, body] = serviceRequest.mock.calls[0]! as [string, string, { objectives: Array<{ objectiveId: string }>; events: Array<{ id: string }> }]
    expect([method, path]).toEqual(['POST', '/v1/me/objectives/pve/sync'])
    expect(body.objectives.map((entry) => entry.objectiveId)).toEqual(['obj-1'])
    expect(body.events.map((event) => event.id)).toEqual(['ev-local-1'])
  })

  it('sends only the events the server has not confirmed, and still applies its whole answer', async () => {
    const answer = { records: [{ taskId: TASK, status: 'completed', updatedAt: '2026-09-25T12:00:00.000Z' }], scope: { characterId: CHARACTER, accountId: 7, syncedAt: 'x' } }
    serviceRequest.mockResolvedValue(answer)
    const apply = vi.fn()
    await pushLogProgress(scan(), () => unregistered, apply)
    await pushLogProgress(scan(), () => unregistered, apply)
    expect(serviceRequest.mock.calls.map((call) => (call[2] as { events: unknown[] }).events.length)).toEqual([1, 0])
    expect(apply).toHaveBeenCalledTimes(2)
    // Another account signed in: everything goes again (its server has none of it).
    status.mockResolvedValue({ signedIn: true, email: 'b@example.com', kind: 'user', online: true, serverUrl: 'http://127.0.0.1:8787', persistent: true })
    await refreshServerStatus()
    await pushLogProgress(scan(), () => unregistered, apply)
    expect((serviceRequest.mock.lastCall![2] as { events: unknown[] }).events).toHaveLength(1)
  })

  it('pushes again right after a push that was running when a new scan came (P15)', async () => {
    let finish!: (value: unknown) => void
    serviceRequest.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    serviceRequest.mockResolvedValue({ records: [], scope: { characterId: CHARACTER } })
    const apply = vi.fn()
    const first = pushLogProgress(scan(), () => unregistered, apply)
    await vi.waitFor(() => expect(serviceRequest).toHaveBeenCalledTimes(1))
    const newer = scan()
    newer.eventsByMode.pve = [...newer.eventsByMode.pve, { taskId: '5936d90786f7742b1420ba5c', status: 'active', timestamp: '2026-09-25T13:00:00.000Z', mode: 'pve' }]
    // The first push is still waiting for the server: this one is not lost, it goes right after.
    await pushLogProgress(newer, () => unregistered, apply)
    expect(serviceRequest).toHaveBeenCalledTimes(1)
    finish({ records: [], scope: { characterId: CHARACTER } })
    await first
    expect(serviceRequest).toHaveBeenCalledTimes(2)
    expect((serviceRequest.mock.calls[0]![2] as { events: Array<{ taskId: string }> }).events.map((event) => event.taskId)).toEqual([TASK])
    expect((serviceRequest.mock.lastCall![2] as { events: Array<{ taskId: string }> }).events.map((event) => event.taskId)).toEqual(['5936d90786f7742b1420ba5c'])
  })

  it('pushes events without a profile line to the character the server keeps for the mode (P17)', async () => {
    const result = scan()
    result.latestCharacterIdByMode = {}
    serviceRequest.mockImplementation(async (method: string) => method === 'GET'
      ? { records: [], scope: { characterId: CHARACTER, accountId: 7, syncedAt: 'x' } }
      : { records: [{ taskId: TASK, status: 'completed', updatedAt: '2026-09-25T12:00:00.000Z' }], scope: { characterId: CHARACTER, accountId: 7, syncedAt: 'x' } })
    const apply = vi.fn()
    await pushLogProgress(result, () => unregistered, apply)
    expect(serviceRequest).toHaveBeenNthCalledWith(1, 'GET', '/v1/me/progress/pve', undefined)
    expect(serviceRequest).toHaveBeenNthCalledWith(2, 'POST', '/v1/me/progress/pve/events', expect.objectContaining({ characterId: CHARACTER }))
    expect(apply).toHaveBeenCalledWith('pve', [expect.objectContaining({ taskId: TASK })], CHARACTER, undefined)
    // No character known anywhere: nothing goes (the events would land under no character).
    forgetProgressSync()
    serviceRequest.mockReset()
    serviceRequest.mockResolvedValue({ records: [], scope: null })
    await pushLogProgress(result, () => unregistered, apply)
    expect(serviceRequest.mock.calls.map((call) => call[0])).toEqual(['GET'])
  })

  it('a desktop pulls a mode its logs do not show, with the server\'s character and reset (P10, P16)', async () => {
    Object.assign(window.tarkovDesktop!, { isDesktop: true })
    const answer = { records: [{ taskId: TASK, status: 'active', updatedAt: '2026-09-25T12:00:00.000Z' }], scope: { characterId: CHARACTER, accountId: 7, syncedAt: 'x', resetAt: '2026-09-20T00:00:00.000Z' } }
    serviceRequest.mockResolvedValue(answer)
    const apply = vi.fn()
    // Nothing known about this PC's logs yet: no pull.
    await pullServerProgress('pvp', apply)
    expect(serviceRequest).not.toHaveBeenCalled()
    // Its logs show PvE only: PvP comes from the server (another PC); PvE is pushed, not pulled.
    await pushLogProgress(scan(), () => unregistered, vi.fn())
    serviceRequest.mockClear()
    expect([pullsServerProgress('pvp'), pullsServerProgress('pve')]).toEqual([true, false])
    await pullServerProgress('pve', apply)
    expect(serviceRequest).not.toHaveBeenCalled()
    await pullServerProgress('pvp', apply)
    expect(serviceRequest).toHaveBeenCalledWith('GET', '/v1/me/progress/pvp', undefined)
    expect(apply).toHaveBeenCalledWith('pvp', [expect.objectContaining({ taskId: TASK })], CHARACTER, '2026-09-20T00:00:00.000Z')
    // No Logs folder on this PC: every mode comes from the server.
    forgetProgressSync()
    noteDesktopLogsMissing()
    expect([pullsServerProgress('pvp'), pullsServerProgress('pve'), pullsServerProgress('seasonal')]).toEqual([true, true, true])
  })

  it('the PC sends its quest decisions of the modes its logs hold, once per change; an app without those logs holds the copy', async () => {
    Object.assign(window.tarkovDesktop!, { isDesktop: true })
    const records = { [TASK]: { taskId: TASK, status: 'completed' as const, source: 'screen-scan' as const, updatedAt: '2026-09-25T12:00:00.000Z' } }
    bindQuestMirrorSource((mode) => mode === 'pve' ? records : {})
    // Before its logs were read: nothing (an app just installed must not send an empty copy over the real one).
    await pushQuestMirror('pve')
    expect(serviceRequest).not.toHaveBeenCalled()
    serviceRequest.mockResolvedValue({ records: [] })
    await pushLogProgress(scan(), () => unregistered, vi.fn())
    const puts = serviceRequest.mock.calls.filter(([method]) => method === 'PUT')
    expect(puts).toEqual([['PUT', '/v1/me/quest-mirror/pve', { at: expect.any(String), records }]])
    serviceRequest.mockClear()
    await pushQuestMirror('pve')
    expect(serviceRequest).not.toHaveBeenCalled()

    // PvP is not in this PC's logs: it takes the PC copy another app sent.
    serviceRequest.mockResolvedValue({ mirror: { at: '2026-09-26T00:00:00.000Z', records, receivedAt: 'x' } })
    await pullQuestMirror('pvp')
    expect(serviceRequest).toHaveBeenCalledWith('GET', '/v1/me/quest-mirror/pvp', undefined)
    expect(JSON.parse(localStorage.getItem('raidos-quest-mirror-v1') ?? '{}').mirrors.pvp.records[TASK].status).toBe('completed')
    serviceRequest.mockClear()
    await pullQuestMirror('pve')
    expect(serviceRequest).not.toHaveBeenCalled()
    bindQuestMirrorSource(null)
  })

  it('reads the server\'s character scope and its reset, and nothing it cannot trust', () => {
    expect(parseServerScope({ scope: { characterId: CHARACTER, resetAt: '2026-09-20T00:00:00Z' } })).toEqual({ characterId: CHARACTER, resetAt: '2026-09-20T00:00:00.000Z' })
    expect(parseServerScope({ scope: { characterId: CHARACTER, resetAt: 'yesterday' } })).toEqual({ characterId: CHARACTER })
    expect(parseServerScope({ scope: { characterId: '' } })).toBeNull()
    expect(parseServerScope({ scope: null })).toBeNull()
    expect(parseServerScope(null)).toBeNull()
  })

  it('sends the chapters read here once, and applies every chapter the server keeps for the character (P9)', async () => {
    const tour = { chapterId: 'story-tour', status: 'active' as const, stageId: 'story-tour-1', updatedAt: '2026-10-01T10:00:00.000Z' }
    const batya = { chapterId: 'story-batya', status: 'completed' as const, updatedAt: '2026-10-01T11:00:00.000Z' }
    serviceRequest.mockResolvedValue({ characterId: CHARACTER, records: [tour, batya] })
    const apply = vi.fn()
    let local: { characterId?: string; records: StoryRecord[] } = { characterId: CHARACTER, records: [tour] }
    bindStorySync({ read: (mode) => mode === 'pvp' ? local : null, apply })
    try {
      await syncStory('pvp')
      expect(serviceRequest).toHaveBeenLastCalledWith('POST', '/v1/me/story/pvp', { characterId: CHARACTER, records: [tour] })
      expect(apply).toHaveBeenCalledWith('pvp', [tour, batya], CHARACTER)
      // Nothing new since: nothing sent again (not even what came from the server), the answer still applied.
      local = { characterId: CHARACTER, records: [tour, batya] }
      await syncStory('pvp')
      expect(serviceRequest).toHaveBeenLastCalledWith('POST', '/v1/me/story/pvp', { characterId: CHARACTER, records: [] })
      // No catalog of the mode: nothing at all. No character known: only the server's chapters are asked for.
      await syncStory('pve')
      expect(serviceRequest).toHaveBeenCalledTimes(2)
      local = { characterId: undefined, records: [{ ...tour, updatedAt: '2026-10-03T10:00:00.000Z' }] }
      await syncStory('pvp')
      expect(serviceRequest).toHaveBeenLastCalledWith('POST', '/v1/me/story/pvp', { records: [] })
    } finally { bindStorySync(null) }
  })
  it('«Ручная отметка»: sends the new marks of a mode with their time, applies every mark the server keeps; a reset sends them again', async () => {
    const mark = { taskId: TASK, status: 'completed' as const, at: '2026-10-15T10:00:00.000Z' }
    const other = { taskId: '5936d90786f7742b1420ba5c', status: 'cleared' as const, at: '2026-10-15T09:00:00.000Z' }
    serviceRequest.mockResolvedValue({ marks: [mark, other, { taskId: '<b>', status: 'completed', at: 'x' }] })
    let local = [mark]
    const apply = vi.fn()
    bindManualSync({ read: () => local, apply })
    try {
      await syncManualMarks('pve')
      expect(serviceRequest).toHaveBeenLastCalledWith('POST', '/v1/me/progress/pve/manual', { marks: [mark] })
      expect(apply).toHaveBeenCalledWith('pve', [mark, other])
      // Nothing new: nothing sent again; a changed mark is.
      await syncManualMarks('pve')
      expect(serviceRequest).toHaveBeenLastCalledWith('POST', '/v1/me/progress/pve/manual', { marks: [] })
      local = [{ ...mark, status: 'cleared' as const, at: '2026-10-15T11:00:00.000Z' }] as never
      await syncManualMarks('pve')
      expect(serviceRequest).toHaveBeenLastCalledWith('POST', '/v1/me/progress/pve/manual', { marks: local })
    } finally { bindManualSync(null) }
    expect(parseManualMarks({ marks: [{ taskId: TASK, status: 'failed', at: '2026-10-15T10:00:00.000Z' }] })).toEqual([])
    expect(parseManualMarks(null)).toBeNull()
  })
})
