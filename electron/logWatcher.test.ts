import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildScanResult, identityScanResult, type ModeLogScanResult } from '../src/import/eftLogTimeline'
import type { RaidState } from '../src/import/raidState'
import { readRaidState, scanLogFolderBySession, scanLogIdentity } from './logScanner'
import { createLogWatcher, GAME_CHECK_MS, GAME_START_RECHECK_MS, LOG_RETRY_MS, type LogWatcherDeps, type PublishedLogScan } from './logWatcher'

const V = '1.1.5.1.47510'
const PVP_PROFILE = '61c4752c091f387bc2448d1c'
const SEASON_PROFILE = '6a71207d270bc68f650dd124'
const QUEST_A = '5ae448bf86f7744d733e55ee'
const QUEST_B = '596a0e1686f7741ddf17dbee'
const NAME = 'log_2026.09.17_23-16-36_1.1.5.0.47426'

const app = (time: string, text: string) => `${time}|${V}|Info|application|${text}`
const quest = (time: string, type: number, taskId: string) => `${time}|${V}|Info|push-notifications|Got notification | ChatMessageReceived
{
  "type": "new_message",
  "message": {
    "type": ${type},
    "templateId": "${taskId} ${type === 12 ? 'successMessageText' : 'description'}"
  }
}`

/** The deps of the real scanner, the sent messages recorded. */
function realDeps(root: string, overrides: Partial<LogWatcherDeps> = {}) {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const deps: LogWatcherDeps = {
    discover: async () => root,
    scan: (folder, options) => scanLogFolderBySession(folder, options),
    identity: (folder, options) => scanLogIdentity(folder, options),
    raidState: (folder) => readRaidState(folder),
    send: (channel, payload) => { sent.push({ channel, payload }) },
    ...overrides,
  }
  const published = () => sent.filter((entry) => entry.channel === 'logs:updated').map((entry) => entry.payload as PublishedLogScan)
  return { deps, sent, published }
}

const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('the main process follows the logs', () => {
  it('publishes a PvP hand-in while a Season event is last in the list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eft-watch-'))
    roots.push(root)
    await mkdir(join(root, NAME))
    const push = join(root, NAME, `${NAME.slice(4)} push-notifications_000.log`)
    await writeFile(join(root, NAME, `${NAME.slice(4)} application_000.log`), [
      app('2026-09-17 23:16:50.714', 'Session mode: Regular'),
      app('2026-09-17 23:17:54.133', `CompleteSelectedProfile ProfileId:${PVP_PROFILE} AccountId:7690289`),
      app('2026-09-18 01:52:26.954', 'Session mode: PvpSeason'),
      app('2026-09-18 01:52:36.513', `CompleteSelectedProfile ProfileId:${SEASON_PROFILE} AccountId:7690289`),
      app('2026-09-18 02:30:00.000', 'Session mode: Regular'),
      app('2026-09-18 02:30:10.000', `CompleteSelectedProfile ProfileId:${PVP_PROFILE} AccountId:7690289`),
    ].join('\n'))
    await writeFile(push, [quest('2026-09-17 23:32:16.000', 10, QUEST_A), quest('2026-09-18 01:59:48.000', 10, QUEST_B)].join('\n'))
    const { deps, published } = realDeps(root)
    const watcher = createLogWatcher(deps)
    watcher.watch(root)
    await watcher.poll()
    const before = published().at(-1)!
    expect(before.events.at(-1)).toMatchObject({ taskId: QUEST_B, mode: 'seasonal' })

    // Back in PvP, «A» handed in: the count of quests stays, the list still ends with the Season event.
    await appendFile(push, `\n${quest('2026-09-18 02:45:00.000', 12, QUEST_A)}`)
    await watcher.poll()
    const after = published().at(-1)!
    expect(after).not.toBe(before)
    expect(after.events).toHaveLength(before.events.length)
    expect(after.events.at(-1)).toEqual(before.events.at(-1))
    expect(after.eventsByMode.pvp).toEqual([expect.objectContaining({ taskId: QUEST_A, status: 'completed' })])

    // Nothing new: nothing published again (the page applied it already).
    const count = published().length
    await watcher.poll()
    expect(published()).toHaveLength(count)
    watcher.stop()
  })

  it('publishes the identity first, then the full read; the page waits only for the identity', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const full = buildScanResult([{ kind: 'mode', at: 1, mode: 'pve' }, { kind: 'profile', at: 2, profileId: PVP_PROFILE, accountId: 5 }, { kind: 'quest', at: 3, taskId: QUEST_A, status: 'active' }], 1)
    const sent: Array<{ channel: string; payload: unknown }> = []
    const watcher = createLogWatcher({
      discover: async () => 'C:/Games/EFT/Logs',
      identity: async () => identityScanResult(full),
      scan: async () => { await blocked; return full },
      raidState: async () => ({ inRaid: false }),
      send: (channel, payload) => { sent.push({ channel, payload }) },
    })
    const status = await watcher.ready()
    expect(status.folder).toBe('C:/Games/EFT/Logs')
    expect(status.result).toMatchObject({ identityOnly: true, latestMode: 'pve', folder: 'C:/Games/EFT/Logs' })
    expect(sent.map((entry) => entry.channel)).toEqual(['game:raid-state', 'logs:updated'])
    release()
    await watcher.poll()
    expect(sent.filter((entry) => entry.channel === 'logs:updated').map((entry) => (entry.payload as ModeLogScanResult).identityOnly ?? false)).toEqual([true, false])
    watcher.stop()
  })

  it('in a raid: the raid state and the identity, no full read until the raid is over', async () => {
    let raid: RaidState = { inRaid: true, since: 1, location: 'Interchange' }
    const scan = vi.fn(async () => buildScanResult([], 1))
    const over = vi.fn()
    const sent: string[] = []
    const watcher = createLogWatcher({
      discover: async () => 'L', identity: async () => identityScanResult(buildScanResult([], 1)), scan,
      raidState: async () => raid, send: (channel) => { sent.push(channel) }, onRaidOver: over,
    })
    watcher.watch('L')
    await watcher.poll()
    expect(watcher.raidState().inRaid).toBe(true)
    expect(scan).not.toHaveBeenCalled()
    raid = { inRaid: false }
    await watcher.poll()
    expect(over).toHaveBeenCalledTimes(1)
    expect(scan).toHaveBeenCalled()
    expect(sent.filter((channel) => channel === 'game:raid-state')).toHaveLength(2)
    watcher.stop()
  })

  it('looks again every minute while nothing is found, and at once when the game\'s window appears', async () => {
    vi.useFakeTimers()
    const discover = vi.fn(async (): Promise<string | undefined> => undefined)
    let game: string | null = null
    const watcher = createLogWatcher({
      discover, identity: async () => identityScanResult(buildScanResult([], 0)), scan: async () => buildScanResult([], 0),
      raidState: async () => ({ inRaid: false }), send: () => {}, gameWindow: () => game,
    })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(discover).toHaveBeenLastCalledWith({ thorough: true, extra: [] })
    expect((await watcher.ready()).notFound).toBe(true)
    discover.mockClear()
    await vi.advanceTimersByTimeAsync(LOG_RETRY_MS)
    // The minute's retry: only the places known already.
    expect(discover).toHaveBeenCalledWith({ thorough: false, extra: [] })
    discover.mockClear()
    // The game starts (its window in front): a full look at once, the Logs folder exists by the recheck.
    game = '1234:99'
    await vi.advanceTimersByTimeAsync(GAME_CHECK_MS)
    expect(discover).toHaveBeenCalledWith({ thorough: true, extra: [] })
    discover.mockResolvedValue('D:/SteamLibrary/steamapps/common/Escape from Tarkov/build/Logs')
    await vi.advanceTimersByTimeAsync(GAME_START_RECHECK_MS)
    expect(watcher.folder()).toBe('D:/SteamLibrary/steamapps/common/Escape from Tarkov/build/Logs')
    // Followed now: the minute's retries stop.
    discover.mockClear()
    await vi.advanceTimersByTimeAsync(LOG_RETRY_MS * 2)
    expect(discover).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('moves to another install when the game started there last', async () => {
    vi.useFakeTimers()
    let freshest = 'C:/Battlestate Games/EFT/Logs'
    const discover = vi.fn(async ({ extra }: { thorough: boolean; extra: string[] }) => extra.length && freshest === extra[0] ? extra[0] : freshest)
    let game: string | null = null
    const folders: string[] = []
    const watcher = createLogWatcher({
      discover, identity: async () => identityScanResult(buildScanResult([], 0)), scan: async () => buildScanResult([], 0),
      raidState: async () => ({ inRaid: false }), send: () => {}, gameWindow: () => game, onFolder: (folder) => folders.push(folder),
    })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(watcher.folder()).toBe('C:/Battlestate Games/EFT/Logs')
    freshest = 'D:/Games/EFT/Logs'
    game = '77:1'
    await vi.advanceTimersByTimeAsync(GAME_CHECK_MS + GAME_START_RECHECK_MS)
    expect(watcher.folder()).toBe('D:/Games/EFT/Logs')
    expect(folders).toEqual(['C:/Battlestate Games/EFT/Logs', 'D:/Games/EFT/Logs'])
    watcher.stop()
  })

  it('summarizes again with the catalog\'s trader quest ids, keeps them, and ignores the same ids twice', async () => {
    const scan = vi.fn(async (_root: string, options: { trustedQuestIds?: Record<string, ReadonlySet<string>> }) => buildScanResult([], options.trustedQuestIds?.pvp?.size ?? 0))
    const saved: unknown[] = []
    const watcher = createLogWatcher({
      discover: async () => 'L', identity: async () => identityScanResult(buildScanResult([], 0)), scan,
      raidState: async () => ({ inRaid: false }), send: () => {},
      loadKept: async () => ({ pve: [QUEST_B] }), saveQuestIds: async (ids) => { saved.push(ids) },
    })
    await watcher.ready()
    await watcher.poll()
    expect(scan.mock.lastCall![1].trustedQuestIds).toEqual({ pve: new Set([QUEST_B]) })
    expect(await watcher.setQuestIds('pvp', [QUEST_A, QUEST_A])).toBe(true)
    await watcher.poll()
    expect(scan.mock.lastCall![1].trustedQuestIds).toEqual({ pvp: new Set([QUEST_A]), pve: new Set([QUEST_B]) })
    expect(saved).toEqual([{ pvp: [QUEST_A], pve: [QUEST_B] }])
    expect(await watcher.setQuestIds('pvp', [QUEST_A])).toBe(false)
    watcher.stop()
  })
})
