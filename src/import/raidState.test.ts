import { describe, expect, it } from 'vitest'
import { raidStateFromLogs } from './raidState'

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
})
