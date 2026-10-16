import { describe, expect, it } from 'vitest'
import type { Quest, RaidMode, TaskRequirement } from '../domain/types'
import { buildScanResult, type LogSignal } from './eftLogTimeline'
import { loggedQuestHistory, logsCoverModes, logsCoverQuestHistory, type LoggedQuestEvent } from './logCoverage'

const id = (n: number) => n.toString(16).padStart(24, '0')
const DEBUT = id(1), SEARCH = id(2), SHORTAGE = id(3), SANITARY_1 = id(4), SANITARY_2 = id(5), CHECKING = id(6)
const FRIEND_USEC = id(7), FRIEND_BEAR = id(8), PARTNER = id(9), OPTION_A = id(10), OPTION_B = id(11), CHOICE = id(12)
const CHAPTER = id(13), AFTER_CHAPTER = id(14), GUNSMITH_1 = id(15), GUNSMITH_2 = id(16), AFTER_UNKNOWN = id(17), UNKNOWN = id(99)

const needs = (taskId: string, allowedStatuses: TaskRequirement['allowedStatuses'] = ['complete'], group?: string): TaskRequirement => ({ taskId, allowedStatuses, ...(group ? { group } : {}) })
const quest = (questId: string, name: string, requirements: TaskRequirement[] = [], extra: Partial<Quest> = {}) => ({
  id: questId, name, trader: 'Prapor', level: 1, kappa: false, description: '', objectives: [], rewards: [], requirements, ...extra,
} as Quest)

/** A slice of the catalog: starters without prerequisites, chains, alternatives, a story chapter, Gunsmith. */
const QUESTS: Quest[] = [
  quest(DEBUT, 'Debut'),
  quest(SEARCH, 'Search Mission', [needs(DEBUT)]),
  quest(SHORTAGE, 'Shortage'),
  quest(SANITARY_1, 'Sanitary Standards - Part 1', [needs(SHORTAGE)]),
  quest(SANITARY_2, 'Sanitary Standards - Part 2', [needs(SANITARY_1)]),
  // Done or failed, either opens it.
  quest(CHECKING, 'Checking', [needs(SEARCH, ['complete', 'failed'])]),
  quest(FRIEND_USEC, 'Friend from the West - Part 1 (USEC)', [], { faction: 'USEC' }),
  quest(FRIEND_BEAR, 'Friend from the West - Part 1 (BEAR)', [], { faction: 'BEAR' }),
  // Lists both factions' versions: a player can only ever do one of them.
  quest(PARTNER, 'Partner', [needs(FRIEND_USEC), needs(FRIEND_BEAR)]),
  quest(OPTION_A, 'Option A'),
  quest(OPTION_B, 'Option B'),
  quest(CHOICE, 'Choice', [needs(OPTION_A, ['complete'], 'either'), needs(OPTION_B, ['complete'], 'either')]),
  quest(CHAPTER, 'Tour', [], { kind: 'story' }),
  quest(AFTER_CHAPTER, 'After the Tour', [needs(CHAPTER)]),
  quest(GUNSMITH_1, 'Gunsmith - Part 1'),
  quest(GUNSMITH_2, 'Gunsmith - Part 2', [needs(GUNSMITH_1)]),
  quest(AFTER_UNKNOWN, 'After a removed quest', [needs(UNKNOWN)]),
]

const accept = (taskId: string): LoggedQuestEvent => ({ taskId, status: 'active' })
const done = (taskId: string): LoggedQuestEvent => ({ taskId, status: 'completed' })
const fail = (taskId: string): LoggedQuestEvent => ({ taskId, status: 'failed' })

/** A profile from its first quest on, oldest first. */
const FRESH: LoggedQuestEvent[] = [
  accept(DEBUT), accept(SHORTAGE), done(DEBUT), accept(SEARCH), done(SHORTAGE), accept(SANITARY_1), fail(SEARCH),
  accept(CHECKING), done(SANITARY_1), accept(SANITARY_2), accept(FRIEND_USEC), done(FRIEND_USEC), accept(PARTNER),
  accept(OPTION_B), done(OPTION_B), accept(CHOICE),
  // Never in the logs (a story chapter, the Gunsmith chain's own order, a quest the catalog no longer has): not asked for.
  accept(AFTER_CHAPTER), accept(GUNSMITH_2), accept(AFTER_UNKNOWN),
]

describe('the logs hold the whole quest history', () => {
  it('for a profile logged from its first quest on', () => {
    expect(logsCoverQuestHistory(FRESH, QUESTS)).toBe(true)
  })

  it('not once the game deleted the oldest logs', () => {
    for (let cut = 1; cut <= 6; cut += 1) expect(logsCoverQuestHistory(FRESH.slice(cut), QUESTS), `cut ${cut}`).toBe(false)
    // Nothing handed in without its acceptance, yet a quest taken after one the logs never saw done.
    const withoutDebut = FRESH.filter((event) => event.taskId !== DEBUT)
    expect(logsCoverQuestHistory(withoutDebut, QUESTS)).toBe(false)
  })

  it('not for a quest handed in or failed without its acceptance', () => {
    expect(logsCoverQuestHistory(FRESH.filter((event) => !(event.taskId === SANITARY_1 && event.status === 'active')), QUESTS)).toBe(false)
    expect(logsCoverQuestHistory([...FRESH, done(id(50))], QUESTS)).toBe(false)
    expect(logsCoverQuestHistory([...FRESH, fail(id(51))], QUESTS)).toBe(false)
  })

  it('takes an alternative prerequisite as met by any of its options', () => {
    // «Checking» opens after «Search Mission» done or failed: failed above.
    expect(logsCoverQuestHistory(FRESH, QUESTS)).toBe(true)
    // No option of «Choice» logged: missing.
    expect(logsCoverQuestHistory(FRESH.filter((event) => event.taskId !== OPTION_B), QUESTS)).toBe(false)
    // The other faction's version of «Friend from the West» instead.
    const bear = FRESH.map((event) => event.taskId === FRIEND_USEC ? { ...event, taskId: FRIEND_BEAR } : event)
    expect(logsCoverQuestHistory(bear, QUESTS)).toBe(true)
    expect(logsCoverQuestHistory(FRESH.filter((event) => event.taskId !== FRIEND_USEC), QUESTS)).toBe(false)
  })

  it('knows nothing from no history at all', () => {
    expect(logsCoverQuestHistory([], QUESTS)).toBe(false)
  })
})

describe('each mode on its own', () => {
  let at = Date.parse('2026-10-01T10:00:00Z')
  const tick = () => (at += 60_000)
  const session = (mode: RaidMode, profileId: string, events: LoggedQuestEvent[]): LogSignal[] => [
    { kind: 'mode', at: tick(), mode },
    { kind: 'profile', at: tick(), profileId, accountId: 5000 },
    ...events.map((event): LogSignal => ({ kind: 'quest', at: tick(), taskId: event.taskId, status: event.status })),
  ]
  const PVP = 'a'.repeat(24), PVE = 'b'.repeat(24), SEASON = 'c'.repeat(24)
  /** An older launch on disk that logged something before these profiles first appeared (they started inside the logs). */
  const before = () => ({ oldestLaunchUntil: at })

  it('never lends one mode the history of another', () => {
    // PvP from its start; PvE took «Search Mission» after a «Debut» only PvP's logs show; the season handed in a quest it
    // never accepted in its logs.
    const options = before()
    const scan = buildScanResult([
      ...session('pvp', PVP, FRESH),
      ...session('pve', PVE, [accept(SEARCH)]),
      ...session('seasonal', SEASON, [done(DEBUT)]),
    ], 3, 0, options)
    expect(logsCoverModes(scan, QUESTS)).toEqual({ pvp: true, pve: false, seasonal: false })
    expect(loggedQuestHistory(scan, 'pve')).toEqual([accept(SEARCH), expect.objectContaining(accept(SEARCH))])
  })

  it('follows the logs: whole in PvE, cut in PvP, and the screen comes back once a gap shows', () => {
    const options = before()
    const signals = [...session('pvp', PVP, FRESH.slice(4)), ...session('pve', PVE, FRESH)]
    expect(logsCoverModes(buildScanResult(signals, 2, 0, options), QUESTS)).toEqual({ pvp: false, pve: true, seasonal: false })
    // The next launch logs a quest handed in that was accepted in a log the game has deleted since.
    const later = buildScanResult([...signals, { kind: 'quest', at: tick(), taskId: id(60), status: 'completed' }], 3, 0, options)
    expect(logsCoverModes(later, QUESTS).pve).toBe(false)
  })

  it('reads only the history since the last trusted profile reset, which starts the history inside the logs', () => {
    // An old profile (its «Debut» handed in), reset: «Debut» accepted again starts the history anew — a catalog quest.
    const signals = [...session('pvp', PVP, [accept(SANITARY_2), done(DEBUT)]), ...session('pvp', PVP, FRESH)]
    const trusted = { trustedQuestIds: { pvp: new Set(QUESTS.map((entry) => entry.id)) } }
    const scan = buildScanResult(signals, 2, 0, trusted)
    expect(scan.summaryByMode.pvp.resetAt).toBeDefined()
    expect(scan.summaryByMode.pvp.historyStartsInLogs).toBe(true)
    expect(logsCoverModes(scan, QUESTS).pvp).toBe(true)
    // Before the catalog told its ids, nothing counts as a reset: the old «Debut» stays in the history, the profile goes
    // back to the oldest launch on disk, and the logs do not hold its history.
    const untrusted = buildScanResult(signals, 2)
    expect(untrusted.summaryByMode.pvp.resetAt).toBeUndefined()
    expect(logsCoverModes(untrusted, QUESTS).pvp).toBe(false)
  })

  it('not for a profile seen in the oldest launch on disk, even when nothing is missing from its history', () => {
    const signals = session('pvp', PVP, FRESH)
    const profileLine = signals.find((signal) => signal.kind === 'profile')!.at
    // The oldest launch logged this profile: it may be older than every log, whatever the history looks like.
    const inOldest = buildScanResult(signals, 1, 0, { oldestLaunchUntil: profileLine })
    expect(inOldest.summaryByMode.pvp.historyStartsInLogs).toBeUndefined()
    expect(logsCoverModes(inOldest, QUESTS).pvp).toBe(false)
    // An older launch logged something else before: the profile started inside the logs.
    const later = buildScanResult(signals, 2, 0, { oldestLaunchUntil: profileLine - 1 })
    expect(later.summaryByMode.pvp.historyStartsInLogs).toBe(true)
    expect(logsCoverModes(later, QUESTS).pvp).toBe(true)
  })

  it('knows nothing from a scan of an older app', () => {
    const scan = buildScanResult(session('pve', PVE, FRESH), 2, 0, before())
    expect(logsCoverModes({ ...scan, acceptedByMode: undefined }, QUESTS).pve).toBe(false)
    // Without the time signal (an app from before it) the content alone never counts.
    expect(logsCoverModes({ eventsByMode: scan.eventsByMode, acceptedByMode: scan.acceptedByMode }, QUESTS).pve).toBe(false)
    expect(logsCoverModes(undefined, QUESTS)).toEqual({ pvp: false, pve: false, seasonal: false })
  })
})
