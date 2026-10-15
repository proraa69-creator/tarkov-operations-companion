import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createLocalProfile, createModeProgress, migrateProfile } from '../domain/progress'
import type { AppDataset, ModeProgress, Quest, RaidMode, TaskProgressRecord } from '../domain/types'
import { withQuestGrid } from '../data/questGrid'
import { buildScanResult, readLogSignals, traderQuestIdsForResets, type ModeLogScanResult } from '../import/eftLogTimeline'
import { applyLogQuestState, applyScanToModes } from '../import/logApply'
import { firstApplication, forgetAppliedLogResults } from '../import/logResults'
import { updateLogStatus } from '../import/logStatus'
import { completedQuestStats, isLiveGameQuest } from '../progression/requirementEngine'
import grid from '../progression/__fixtures__/quest-grid-tasks-2026-10.json'
import ownerLogs from '../progression/__fixtures__/owner-logs-2026-09.json'
import { AppStateProvider, useAppState } from '../state/AppState'
import { diagnosticsLine, withInferred } from './questEngine'
import { questAvailabilityOf, questResolutionOf } from './questReadModel'

/** The fixture's PvE tasks as the catalog gives them, with the lines of the snapshot (as src/progression/chronology.test.ts). */
function fixtureQuests(): Quest[] {
  const { traders, tasks } = grid.pve
  const quests = (tasks as unknown as Array<[string, string, number, number, { r?: string[][]; l?: Array<[number, number]>; f?: string; k?: number }?]>).map(([id, name, trader, level, extra]): Quest => ({
    id, name, trader: traders[trader][1], traderId: traders[trader][0], level, kappa: Boolean(extra?.k), faction: extra?.f, description: '', objectives: [], rewards: [],
    requirements: (extra?.r ?? []).map(([taskId, ...statuses]) => ({ taskId, allowedStatuses: statuses as Array<'complete' | 'failed' | 'active'> })),
    ...(extra?.l ? { traderLoyalty: { needed: extra.l.map(([index, loyalty]) => ({ traderId: traders[index]?.[0] ?? String(index), level: loyalty })), reached: [] } } : {}),
  } as Quest))
  return withQuestGrid({ quests, traders: traders.map(([id, name]) => ({ id, name })) } as unknown as AppDataset, 'pve').quests
}

const ownerEvents = (mode: 'pve' | 'pvp') => (ownerLogs.events[mode] as Array<[string, TaskProgressRecord['status'], string]>).map(([timestamp, status, taskId]) => ({ taskId, status, timestamp }))

describe('PvE «226 выполнено» while the game had 154 (owner, 15.10.2026)', () => {
  const quests = fixtureQuests()
  const live = new Set(quests.filter((quest) => isLiveGameQuest(quest)).map((quest) => quest.id))
  const pve = (): ModeProgress => applyLogQuestState({ ...createModeProgress(), playerLevel: 40, faction: 'bear' }, ownerEvents('pve'), { mode: 'pve', keepPreviousLogRecords: true })

  it('the old count took every quest the lists infer as done; «Выполнено» now counts only what the engine decided', () => {
    const progress = pve()
    const availability = questAvailabilityOf(quests, progress)
    // The path that inflated it (requirementEngine.ts completedQuestStats up to 0.6.0.41): availability «completed», the
    // prerequisite chains and the chronology included.
    const oldCount = quests.filter((quest) => live.has(quest.id) && availability.get(quest.id)?.status === 'completed').length
    expect(oldCount).toBeGreaterThan(200)
    const handedIn = Object.values(progress.taskProgress).filter((record) => record.status === 'completed' && live.has(record.taskId)).length
    expect(handedIn).toBe(1)
    // The owner's panel explains it at a glance: the hand-in, the prerequisites the held quests prove (counted — no one
    // takes a quest before them; the logs reach back only a few weeks) and the chronology's guesses (never counted).
    const resolution = questResolutionOf(progress, 'pve', quests)
    const diagnostics = withInferred(resolution.diagnostics, availability)
    expect(diagnostics.decided.log.completed).toBe(1)
    expect(diagnostics.proven).toBeGreaterThan(0)
    expect(completedQuestStats(quests, availability).completed).toBe(handedIn + diagnostics.proven!)
    expect(diagnostics.inferred! + diagnostics.proven!).toBe(oldCount - 1)
    expect(diagnosticsLine(diagnostics)).toBe(`логи: 1 выполнено, требуются для них: +${diagnostics.proven}, экран: +0, вручную: 0, догадка по хронологии: ${diagnostics.inferred} (не считается)`)
  })

  it('an older version\'s Tasks-table chain completions («screen-scan» completed) are no longer counted after the update', () => {
    const profile = createLocalProfile('Оператор', 'owner')
    const guessed = quests.filter((quest) => live.has(quest.id)).slice(0, 70).map((quest) => quest.id)
    profile.modes.pve = { ...pve(), questInputs: undefined }
    for (const taskId of guessed) {
      if (!profile.modes.pve.taskProgress[taskId]) profile.modes.pve.taskProgress[taskId] = { taskId, status: 'completed', source: 'screen-scan', updatedAt: '2026-09-27T10:00:00.000Z' }
    }
    const before = Object.values(profile.modes.pve.taskProgress).filter((record) => record.status === 'completed').length
    expect(before).toBeGreaterThan(60)
    const migrated = migrateProfile(JSON.parse(JSON.stringify(profile)))!
    const availability = questAvailabilityOf(quests, migrated.modes.pve)
    // The same count as the logs alone give: the guessed rows add nothing.
    expect(completedQuestStats(quests, availability).completed).toBe(completedQuestStats(quests, questAvailabilityOf(quests, pve())).completed)
    const resolution = questResolutionOf(migrated.modes.pve, 'pve', quests)
    expect(resolution.diagnostics.conflicts['table-completed-unproven']).toBe(before - 1)
  })

  it('PvP after its reset: the hand-ins since, nothing inferred', () => {
    const progress = { ...applyLogQuestState({ ...createModeProgress(), playerLevel: 5, faction: 'bear' as const }, ownerEvents('pvp'), { mode: 'pvp', keepPreviousLogRecords: true }), logResetAt: ownerLogs.resets.pvp }
    const resolution = questResolutionOf(progress, 'pvp', quests)
    const since = new Map<string, string>()
    for (const event of ownerEvents('pvp')) if (event.timestamp >= ownerLogs.resets.pvp) since.set(event.taskId, event.status)
    const expected = [...since].filter(([taskId, status]) => status === 'completed' && live.has(taskId)).length
    expect(expected).toBeGreaterThan(0)
    const counted = [...resolution.states.values()].filter((state) => state.status === 'completed' && live.has(state.taskId)).length
    expect(counted).toBe(expected)
    expect(resolution.diagnostics.beforeFloor).toBeGreaterThan(0)
  })
})

/**
 * Detection after «Престиж +» with the owner's clock (UTC+7: the game logs local time without an offset), through the
 * app: the scan the main process publishes, the once-per-scan guard, the engine.
 */
describe('after «Престиж +» on a UTC+7 PC', () => {
  const zone = process.env.TZ
  beforeAll(() => { process.env.TZ = 'Asia/Novosibirsk' })
  afterAll(() => { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone })

  const PROFILE = 'b'.repeat(24)
  const [OLD, NEW, LATER] = ['5936d90786f7742b1420ba5b', '5936d90786f7742b1420ba5c', '5936d90786f7742b1420ba5d']
  const quests = [OLD, NEW, LATER].map((id) => ({ id, name: id, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] } as unknown as Quest))
  const trusted = { pvp: new Set(traderQuestIdsForResets(quests)), pve: new Set(traderQuestIdsForResets(quests)), seasonal: new Set<string>() }
  /** «2026-10-15 19:30:00.000|…» in the PC's local time, as EFT writes it. */
  const line = (ms: number, text: string) => {
    const d = new Date(ms)
    const pad = (n: number, w = 2) => String(n).padStart(w, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}|1.2.0.0|Info|application|${text}`
  }
  const quest = (ms: number, taskId: string, type: 10 | 12) => `${line(ms, 'Got notification | ChatMessageReceived')}\n{"message":{"type":${type},"templateId":"${taskId} 0"}}`
  const scanOf = (...texts: string[]): ModeLogScanResult => buildScanResult(texts.flatMap((text) => readLogSignals(text)), texts.length, 0, { trustedQuestIds: trusted })
  const probe: { app?: ReturnType<typeof useAppState> } = {}
  function Probe() { const app = useAppState(); useEffect(() => { probe.app = app }); return null }
  const statuses = (mode: RaidMode) => Object.fromEntries(Object.values(probe.app!.activeProfile.modes[mode].taskProgress).map((record) => [record.taskId, record.status]))
  /** AppShell's application of a published scan (once per scan: src/import/logResults.ts). */
  const apply = (scan: ModeLogScanResult) => {
    updateLogStatus({ scan })
    if (!firstApplication(scan, probe.app!.activeProfile.id)) return
    act(() => applyScanToModes(scan, (mode) => probe.app!.activeProfile.modes[mode].registration, (mode, events, characterId, resetAt, characterSince) => probe.app!.applyLogScanForMode(mode, events, { characterId, resetAt, characterSince })))
  }

  beforeEach(() => {
    localStorage.clear()
    forgetAppliedLogResults()
    const profile = createLocalProfile('Оператор', 'utc7')
    profile.selectedMode = 'pve'
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
    render(<AppStateProvider><Probe /></AppStateProvider>)
  })

  it('reads the local times as UTC+7; after the press every line and launch counts, and the game\'s own reset is the floor', () => {
    // 12:00 local on the owner's PC is 05:00 UTC.
    expect(line(Date.parse('2026-10-15T05:00:00Z'), 'x')).toMatch(/^2026-10-15 12:00:00\.000\|/)
    expect(readLogSignals(line(Date.parse('2026-10-15T05:00:00Z'), 'Session mode: Pve'))[0]!.at).toBe(Date.parse('2026-10-15T05:00:00Z'))
    const T0 = Date.parse('2026-10-15T05:00:00Z')
    const first = [line(T0, 'Session mode: Pve'), line(T0 + 1000, `SelectProfile ProfileId:${PROFILE} AccountId:1`), quest(T0 + 60_000, OLD, 10), quest(T0 + 120_000, OLD, 12)].join('\n')
    apply(scanOf(first))
    expect(statuses('pve')).toEqual({ [OLD]: 'completed' })

    // «Престиж +» one hour later (stored in UTC): an app-only press hides nothing, the logs bring it back at once.
    const pressed = T0 + 3_600_000
    act(() => probe.app!.resetModeProgress('pve', new Date(pressed).toISOString(), 'prestige', { prestige: 2 }))
    expect(statuses('pve')).toEqual({ [OLD]: 'completed' })

    // An appended line in the same launch 10 minutes after the press, local time.
    const appended = `${first}\n${quest(pressed + 600_000, NEW, 10)}`
    apply(scanOf(appended))
    expect(statuses('pve')).toEqual({ [OLD]: 'completed', [NEW]: 'active' })
    // A new launch folder later, where the game's own prestige shows: OLD taken again after its hand-in.
    const launch = [line(pressed + 7_200_000, 'Session mode: Pve'), line(pressed + 7_201_000, `SelectProfile ProfileId:${PROFILE} AccountId:1`), quest(pressed + 7_260_000, OLD, 10), quest(pressed + 7_320_000, LATER, 10)].join('\n')
    apply(scanOf(appended, launch))
    expect(statuses('pve')).toEqual({ [OLD]: 'active', [LATER]: 'active' })
    expect(probe.app!.activeProfile.modes.pve.logResetAt).toBe(new Date(pressed + 7_201_000).toISOString())
    expect(probe.app!.activeProfile.modes.pve.resetMarker?.resolvedAt).toBe(new Date(pressed + 7_201_000).toISOString())
    // A line written before the game's reset never counts again, even when it is read only now.
    apply(scanOf(`${appended}\n${quest(pressed + 7_000_000, NEW, 12)}`, launch))
    expect(statuses('pve')[NEW]).toBeUndefined()
    expect(probe.app!.activeProfile.modes.pve.prestige).toBe(2)
  })
})
