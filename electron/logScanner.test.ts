import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanLogFolderBySession } from './logScanner'

const taskId = '5936d90786f7742b1420ba5b'

describe('session-aware EFT log scanner', () => {
  it('partitions mixed historical sessions by mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eft-logs-'))
    const pvp = join(root, 'log_2026.09.25_10-00-00')
    const pve = join(root, 'log_2026.09.25_11-00-00')
    await mkdir(pvp)
    await mkdir(pve)
    await writeFile(join(pvp, 'application_000.log'), `Session mode: Regular\nCompleteSelectedProfile ProfileId:0123456789abcdef01234567 AccountId:100`)
    await writeFile(join(pvp, 'push-notifications_000.log'), `{"message":{"type":12,"templateId":"${taskId} 0"},"time":"2026-09-25T10:01:00Z"}`)
    await writeFile(join(pve, 'application_000.log'), `Session mode: Pve\nCompleteSelectedProfile ProfileId:1123456789abcdef01234567 AccountId:200`)
    await writeFile(join(pve, 'push-notifications_000.log'), `{"message":{"type":10,"templateId":"${taskId} 0"},"time":"2026-09-25T11:01:00Z"}`)

    const result = await scanLogFolderBySession(root)
    expect(result.eventsByMode.pvp[0]).toMatchObject({ taskId, status: 'completed', mode: 'pvp' })
    expect(result.eventsByMode.pve[0]).toMatchObject({ taskId, status: 'active', mode: 'pve' })
    expect(result.latestAccountIdByMode).toEqual({ pvp: 100, pve: 200 })
    expect(result.unresolvedEvents).toHaveLength(0)
  })
})
