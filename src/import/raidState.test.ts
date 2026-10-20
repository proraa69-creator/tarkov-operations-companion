import { describe, expect, it } from 'vitest'
import { raidMapToken, raidStateFromLogs } from './raidState'
import { canonicalMapId } from '../data/mapIds'

const APP = [
  '2026-09-27 16:00:25.532|1.1.5.1.47510|Info|application|Session mode: Regular',
  '2026-09-27 16:00:40.100|1.1.5.1.47510|Info|application|CompleteSelectedProfile ProfileId:61c4752c091f387bc2448d1c AccountId:7690289',
  '2026-09-27 16:04:48.192|1.1.5.1.47510|Info|application|LocationLoaded:22.91 real:37.31 diff:14.4',
  "2026-09-27 16:06:10.152|1.1.5.1.47510|Debug|application|TRACE-NetworkGameCreate profileStatus: 'Profileid: 61c4752c091f387bc2448d1c, Status: Busy, RaidMode: Online, Ip: 1.2.3.4, Port: 17008, Location: Interchange, Sid: X'",
  '2026-09-27 16:07:31.540|1.1.5.1.47510|Info|application|GameStarted:172.04(172.04) real:200.66(200.66) diff:28.62',
]
const OVER = '2026-09-27 16:38:22.771|1.1.5.1.47510|Info|push-notifications|Got notification | UserMatchOver'
const BACK = '2026-09-27 16:38:46.207|1.1.5.1.47510|Info|application|CompleteSelectedProfile ProfileId:61c4752c091f387bc2448d1c AccountId:7690289'
const now = Date.parse('2026-09-27T16:20:00')

describe('raid state from the game logs', () => {
  it('is in a raid from loading until the match is over', () => {
    expect(raidStateFromLogs([APP.slice(0, 2).join('\n')], now).inRaid).toBe(false)
    expect(raidStateFromLogs([APP.slice(0, 3).join('\n')], now).inRaid).toBe(true)
    expect(raidStateFromLogs([APP.join('\n')], now)).toMatchObject({ inRaid: true, location: 'Interchange' })
    expect(raidStateFromLogs([APP.join('\n'), OVER], now).inRaid).toBe(false)
    expect(raidStateFromLogs([[...APP, BACK].join('\n')], now).inRaid).toBe(false)
  })

  it('leaves the raid when matching is aborted', () => {
    const aborted = '2026-09-27 16:05:10.000|1.1.5.1.47510|Info|application|Network game matching aborted. ErrorCode: 0'
    expect(raidStateFromLogs([[...APP.slice(0, 3), aborted].join('\n')], now).inRaid).toBe(false)
  })

  it('treats a raid that never ended hours ago as a crashed client', () => {
    expect(raidStateFromLogs([APP.join('\n')], Date.parse('2026-09-27T21:00:00')).inRaid).toBe(false)
  })

  it('a local PvE raid without «TRACE-NetworkGameCreate»: the map from the scene the game loads (owner, 20.10.2026: Factory opened Interchange)', () => {
    const at = (time: string, text: string) => `2026-10-20 ${time}|1.2.5.0.48145|Info|application|${text}`
    const pve = [
      at('15:00:01.000', 'Session mode: Pve'),
      at('15:00:05.000', 'CompleteSelectedProfile ProfileId:61c4752c091f387bc2448d1c AccountId:7690289'),
      at('15:01:10.000', 'scene preset path:maps/factory_rework_day_preset.bundle rcid:factory_rework_day_preset.ScenesPreset.asset'),
      at('15:01:12.000', 'SelectProfile ProfileId:61c4752c091f387bc2448d1c AccountId:7690289'),
      at('15:01:30.000', 'LocationLoaded:12.10 real:18.00 diff:5.9'),
      at('15:02:10.000', 'GameStarted:40.00(40.00) real:60.00(60.00) diff:20.0'),
    ]
    const state = raidStateFromLogs([pve.join('\n')], Date.parse('2026-10-20T15:05:00'))
    expect(state).toMatchObject({ inRaid: true })
    expect(canonicalMapId(state.location ?? '')).toBe('factory')
    // A hint during the raid names it too; the next raid does not inherit the map of the last one.
    const during = [at('15:10:00.000', 'LocationLoaded:5 real:6 diff:1'), at('15:10:02.000', 'scene preset path:maps/shopping_mall.bundle')]
    expect(canonicalMapId(raidStateFromLogs([during.join('\n')], Date.parse('2026-10-20T15:12:00')).location ?? '')).toBe('interchange')
    const next = [...pve, at('15:30:00.000', 'CompleteSelectedProfile ProfileId:61c4752c091f387bc2448d1c AccountId:7690289'), at('15:31:00.000', 'LocationLoaded:12.10 real:18.00 diff:5.9')]
    expect(raidStateFromLogs([next.join('\n')], Date.parse('2026-10-20T15:32:00'))).toMatchObject({ inRaid: true, location: undefined })
    // A map hint from long before (another raid's loading that never started) is not taken.
    const stale = [at('14:00:00.000', 'scene preset path:maps/woods_preset.bundle'), at('15:00:00.000', 'LocationLoaded:1 real:1 diff:0')]
    expect(raidStateFromLogs([stale.join('\n')], Date.parse('2026-10-20T15:01:00')).location).toBeUndefined()
  })

  it('a profile re-selected while a local raid loads does not lose the map its start line named', () => {
    const at = (time: string, text: string) => `2026-10-20 ${time}|1.2.5.0.48145|Debug|application|${text}`
    const lines = [
      at('16:00:00.000', "TRACE-NetworkGameCreate profileStatus: 'Profileid: 61c4752c091f387bc2448d1c, Status: Busy, RaidMode: Local, Location: factory4_day, Sid: X'"),
      at('16:00:20.000', 'SelectProfile ProfileId:61c4752c091f387bc2448d1c AccountId:7690289'),
      at('16:00:40.000', 'LocationLoaded:12.10 real:18.00 diff:5.9'),
      at('16:01:20.000', 'GameStarted:40.00(40.00) real:60.00(60.00) diff:20.0'),
    ]
    const state = raidStateFromLogs([lines.join('\n')], Date.parse('2026-10-20T16:05:00'))
    expect(state.inRaid).toBe(true)
    expect(canonicalMapId(state.location ?? '')).toBe('factory')
  })

  it('the game\'s map names — location ids, display names, scene bundles — read as the app\'s maps; anything else not', () => {
    for (const [token, map] of [['factory4_day', 'factory'], ['factory_rework_night_preset', 'factory'], ['bigmap', 'customs'], ['customs_preset', 'customs'], ['shopping_mall', 'interchange'], ['Interchange', 'interchange'], ['rezerv_base_preset', 'reserve'], ['laboratory_preset', 'the-lab'], ['city_preset', 'streets-of-tarkov'], ['TarkovStreets', 'streets-of-tarkov'], ['sandbox_high_preset', 'ground-zero'], ['Lighthouse', 'lighthouse'], ['Shoreline', 'shoreline'], ['Woods', 'woods'], ['Labyrinth', 'the-labyrinth']]) {
      expect(canonicalMapId(raidMapToken(token) ?? ''), token).toBe(map)
    }
    for (const token of ['hideout_preset', 'main_menu', '', undefined]) expect(raidMapToken(token), String(token)).toBeUndefined()
  })
})
