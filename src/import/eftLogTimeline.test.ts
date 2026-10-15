import { describe, expect, it } from 'vitest'
import type { RaidMode } from '../domain/types'
import { buildScanResult, explicitModesWin, identityScanResult, logScanSignature, readLogSignals, traderQuestIdsForResets, type LogSignal } from './eftLogTimeline'

const PVP = '61c4752c091f387bc2448d1c'
const SEASON = '6a71207d270bc68f650dd124'
const QUEST_A = '5ae448bf86f7744d733e55ee'
const QUEST_B = '596a0e1686f7741ddf17dbee'
/** A daily's template id: accepted and handed in day after day, never in the catalog. */
const DAILY = '616041eb031af660100c9967'

let clock = Date.parse('2026-10-01T10:00:00Z')
const tick = () => (clock += 60_000)
const mode = (raidMode: RaidMode, via?: 'gateway'): LogSignal => ({ kind: 'mode', at: tick(), mode: raidMode, ...(via ? { via } : {}) })
const profile = (profileId: string): LogSignal => ({ kind: 'profile', at: tick(), profileId, accountId: 7690289 })
const quest = (taskId: string, status: 'active' | 'completed' | 'failed'): LogSignal => ({ kind: 'quest', at: tick(), taskId, status })

describe('the publish signature', () => {
  it('changes for a PvP hand-in while a Season event is last in the list', () => {
    const pvpAccepted = [mode('pvp'), profile(PVP), quest(QUEST_A, 'active')]
    const season = [mode('seasonal'), profile(SEASON), quest(QUEST_B, 'active')]
    const before = buildScanResult([...pvpAccepted, ...season], 1)
    // Back in PvP, «A» handed in: the same number of quests, and the list still ends with the Season event.
    const after = buildScanResult([...pvpAccepted, ...season, mode('pvp'), quest(QUEST_A, 'completed')], 1)
    expect(after.events).toHaveLength(before.events.length)
    expect(after.events.at(-1)).toEqual(before.events.at(-1))
    expect(after.signature).not.toBe(before.signature)
    expect(after.eventsByMode.pvp).toEqual([expect.objectContaining({ taskId: QUEST_A, status: 'completed' })])
  })

  it('stays the same for the same logs, and covers resets, profiles, acceptances and the launches read', () => {
    const signals = [mode('pvp'), profile(PVP), quest(QUEST_A, 'active')]
    const scan = buildScanResult(signals, 2)
    expect(buildScanResult(signals, 2).signature).toBe(scan.signature)
    expect(logScanSignature(scan)).toBe(scan.signature)
    expect(buildScanResult(signals, 3).signature).not.toBe(scan.signature)
    const variants = [
      { ...scan, summaryByMode: { ...scan.summaryByMode, pvp: { ...scan.summaryByMode.pvp, resetAt: '2026-10-01T09:00:00.000Z' } } },
      { ...scan, summaryByMode: { ...scan.summaryByMode, pvp: { ...scan.summaryByMode.pvp, profileId: SEASON } } },
      { ...scan, summaryByMode: { ...scan.summaryByMode, pvp: { ...scan.summaryByMode.pvp, accountId: 1 } } },
      { ...scan, summaryByMode: { ...scan.summaryByMode, pvp: { ...scan.summaryByMode.pvp, historyStartsInLogs: true } } },
      { ...scan, acceptedByMode: { ...scan.acceptedByMode!, pvp: [] } },
      { ...scan, latestMode: 'pve' as const },
    ]
    for (const variant of variants) expect(logScanSignature(variant)).not.toBe(scan.signature)
  })
})

describe('profile resets count only for the catalog trader quests', () => {
  const ids = (...list: string[]) => ({ trustedQuestIds: { pvp: new Set(list) } })

  it('not for two dailies of the same type (one template id the catalog does not list)', () => {
    const signals = [mode('pvp'), profile(PVP), quest(QUEST_A, 'active'), quest(QUEST_A, 'completed'), quest(DAILY, 'active'), quest(DAILY, 'completed'), profile(PVP), quest(DAILY, 'active')]
    const scan = buildScanResult(signals, 1, 0, ids(QUEST_A, QUEST_B))
    expect(scan.summaryByMode.pvp.resetAt).toBeUndefined()
    expect(scan.eventsByMode.pvp.map((event) => [event.taskId, event.status])).toEqual([[QUEST_A, 'completed'], [DAILY, 'active']])
  })

  it('not before the catalog told any id, and not for another mode\'s ids', () => {
    const signals = [mode('pvp'), profile(PVP), quest(QUEST_A, 'active'), quest(QUEST_A, 'completed'), profile(PVP), quest(QUEST_A, 'active')]
    expect(buildScanResult(signals, 1).summaryByMode.pvp.resetAt).toBeUndefined()
    expect(buildScanResult(signals, 1, 0, { trustedQuestIds: { seasonal: new Set([QUEST_A]) } }).summaryByMode.pvp.resetAt).toBeUndefined()
  })

  it('for a catalog trader quest accepted again after its hand-in (a prestige)', () => {
    const signals = [mode('pvp'), profile(PVP), quest(QUEST_B, 'active'), quest(QUEST_A, 'active'), quest(QUEST_A, 'completed')]
    const load = tick()
    const scan = buildScanResult([...signals, { kind: 'profile', at: load, profileId: PVP, accountId: 7690289 }, quest(QUEST_A, 'active')], 1, 0, ids(QUEST_A))
    expect(scan.summaryByMode.pvp.resetAt).toBe(new Date(load).toISOString())
    expect(scan.summaryByMode.pvp.historyStartsInLogs).toBe(true)
    expect(scan.eventsByMode.pvp.map((event) => [event.taskId, event.status])).toEqual([[QUEST_A, 'active']])
  })

  it('takes only the game ids of trader quests from a catalog', () => {
    expect(traderQuestIdsForResets([
      { id: QUEST_A }, { id: QUEST_B, kind: 'trader' }, { id: 'wiki:Тур' }, { id: 'story-tour', kind: 'story' },
      { id: SEASON, storyChapterId: 'tour' }, { id: 'not-an-id' },
    ])).toEqual([QUEST_A, QUEST_B])
  })
})

describe('the mode of a launch', () => {
  it('comes from «Session mode» lines; a stray request to another mode\'s gateway moves nothing', () => {
    const launch = [mode('pve'), profile(PVP.replace('6', '7')), { kind: 'mode', at: tick(), mode: 'pvp', via: 'gateway' } as LogSignal, quest(QUEST_A, 'active')]
    expect(buildScanResult(launch, 1).eventsByMode.pvp.map((event) => event.taskId)).toEqual([QUEST_A])
    const filtered = buildScanResult(explicitModesWin(launch), 1)
    expect(filtered.eventsByMode.pve.map((event) => event.taskId)).toEqual([QUEST_A])
    expect(filtered.eventsByMode.pvp).toEqual([])
  })

  it('comes from the gateway hosts in a launch that logged no «Session mode»', () => {
    const launch = [mode('pve', 'gateway'), quest(QUEST_A, 'active'), mode('pvp', 'gateway'), quest(QUEST_B, 'active')]
    expect(explicitModesWin(launch)).toBe(launch)
    const scan = buildScanResult(explicitModesWin(launch), 1)
    expect(scan.eventsByMode.pve.map((event) => event.taskId)).toEqual([QUEST_A])
    expect(scan.eventsByMode.pvp.map((event) => event.taskId)).toEqual([QUEST_B])
  })

  it('marks the signals of gateway hosts', () => {
    const text = [
      '2026-09-26 22:05:12.029|1.1.5.1|Info|application|Session mode: Pve',
      '2026-09-26 22:05:45.000|1.1.5.1|Info|backend|---> Request HTTPS, id [1]: URL: https://gw-pve.escapefromtarkov.com/client/game/keepalive.',
    ].join('\n')
    expect(readLogSignals(text).map((signal) => signal.kind === 'mode' ? [signal.mode, signal.via ?? 'session'] : [])).toEqual([['pve', 'session'], ['pve', 'gateway']])
  })
})

describe('the character of a mode', () => {
  it('is known since its first profile load after another profile of the mode', () => {
    // Two game accounts on one PC: PvP of the first, of the second, then of the first again (and once more).
    const signals = [mode('pvp'), profile(PVP), quest(QUEST_A, 'active'), profile(SEASON)]
    const back = profile(PVP)
    const scan = buildScanResult([...signals, back, quest(QUEST_B, 'active'), profile(PVP)], 1)
    expect(scan.summaryByMode.pvp.profileId).toBe(PVP)
    expect(scan.summaryByMode.pvp.profileSince).toBe(new Date(back.at).toISOString())
  })

  it('identity first: the mode, the accounts and the profiles, no quests to apply', () => {
    const scan = buildScanResult([mode('pvp'), profile(PVP), quest(QUEST_A, 'active'), mode('seasonal'), profile(SEASON)], 2)
    const identity = identityScanResult(scan)
    expect(identity).toMatchObject({ identityOnly: true, latestMode: 'seasonal', latestCharacterIdByMode: { pvp: PVP, seasonal: SEASON }, latestAccountIdByMode: { pvp: 7690289, seasonal: 7690289 }, events: [] })
    expect(identity.eventsByMode).toEqual({ pvp: [], pve: [], seasonal: [] })
    // Nothing to apply even for code that does not know `identityOnly` (src/import/logApply.ts applies modes with activity).
    expect(Object.values(identity.summaryByMode).every((summary) => !summary.lastActivityAt)).toBe(true)
    expect(identity.signature).not.toBe(scan.signature)
  })
})

describe('the game\'s own profile resets in the backend log (owner, 15.10.2026: «из журналов должна получаться вся информация по максимуму»)', () => {
  const P = '5936d90786f7742b1420ba5b'
  const PROFILE = 'b'.repeat(24)
  const app = (time: string, text: string) => `2026-10-15 ${time}.000|1.2.0.0|Info|application|${text}`
  const backend = (time: string, text: string) => `2026-10-15 ${time}.000|1.2.0.0|Info|backend|${text}`
  const quest = (time: string, type: number) => `2026-10-15 ${time}.000|1.2.0.0|Info|push-notifications|Got notification | ChatMessageReceived\n{"message":{"type":${type},"templateId":"${P} 0"}}`

  it('a new profile request (a wipe or a profile reset) on a mode\'s gateway is that mode\'s reset; a response line is not a second one', () => {
    const text = [
      app('10:00:00', 'Session mode: Regular'), app('10:00:01', `SelectProfile ProfileId:${PROFILE} AccountId:1`),
      quest('10:01:00', 10), quest('10:02:00', 12),
      backend('11:00:00', '---> Request HTTPS, id [7]: URL: https://gw-pvp.escapefromtarkov.com/client/game/profile/create, crc: .'),
      backend('11:00:01', '<--- Response HTTPS, id [7]: URL: https://gw-pvp.escapefromtarkov.com/client/game/profile/create, crc: .'),
      app('11:01:00', `SelectProfile ProfileId:${PROFILE} AccountId:1`), quest('11:02:00', 10),
    ].join('\n')
    const signals = readLogSignals(text)
    expect(signals.filter((signal) => signal.kind === 'reset')).toEqual([{ kind: 'reset', at: expect.any(Number), via: 'profile-create', mode: 'pvp' }])
    const scan = buildScanResult(signals, 1)
    expect(scan.summaryByMode.pvp).toMatchObject({ resetVia: 'profile-create', resetAt: new Date(signals.find((signal) => signal.kind === 'reset')!.at).toISOString() })
    expect(scan.eventsByMode.pvp).toEqual([expect.objectContaining({ taskId: P, status: 'active' })])
    // Other modes: nothing.
    expect(scan.summaryByMode.pve.resetAt).toBeUndefined()
  })
})
