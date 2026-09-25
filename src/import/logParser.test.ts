import { describe, expect, it } from 'vitest'
import { eventsToProgressRecords, mergeParseResults, parseEftLog } from './logParser'

const taskId = '5936d90786f7742b1420ba5b'

describe('EFT log parser', () => {
  it('extracts quest notifications and the session mode', () => {
    const result = parseEftLog(`2026-09-25 10:00:00 Session mode: Pve
2026-09-25 10:01:00 Got notification | ChatMessageReceived {"message":{"type":10,"templateId":"${taskId} 0"}}
2026-09-25 10:03:00 Got notification | ChatMessageReceived {"message":{"type":12,"templateId":"${taskId} 0"}}`)
    expect(result.detectedModes).toEqual(['pve'])
    expect(result.events).toEqual([{ taskId, status: 'completed', timestamp: new Date('2026-09-25T10:03:00').toISOString(), mode: 'pve' }])
    expect(result.accountIds).toEqual([])
  })

  it('detects seasonal sessions and the selected account id', () => {
    const result = parseEftLog(`Session mode: PvPSeason
CompleteSelectedProfile ProfileId:0123456789abcdef01234567 AccountId:7690289`)
    expect(result.detectedModes).toEqual(['seasonal'])
    expect(result.accountIds).toEqual([7690289])
    expect(result.profileIds).toEqual(['0123456789abcdef01234567'])
  })

  it('supports multiline JSON and ignores unrelated notifications', () => {
    const result = parseEftLog(`Session mode: Regular
Got notification | ChatMessageReceived {
  "message": { "type": 11, "templateId": "${taskId} 0" }
}
{"message":{"type":4,"templateId":"market"}}`)
    expect(result.events[0]).toMatchObject({ taskId, status: 'failed', mode: 'pvp' })
  })

  it('merges files idempotently and converts events to progress records', () => {
    const active = parseEftLog(`{"message":{"type":10,"templateId":"${taskId} 0"},"time":"2026-09-25T10:00:00Z"}`)
    const complete = parseEftLog(`{"message":{"type":12,"templateId":"${taskId} 0"},"time":"2026-09-25T11:00:00Z"}`)
    const merged = mergeParseResults([active, complete, complete])
    expect(merged.events).toHaveLength(1)
    expect(eventsToProgressRecords(merged.events)[0]).toMatchObject({ status: 'completed', source: 'eft-log' })
  })
})
