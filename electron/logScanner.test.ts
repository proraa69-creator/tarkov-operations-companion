import { appendFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readScreenshotBinding, scanLogFolderBySession } from './logScanner'

const V = '1.1.5.1.47510'
const PVP_PROFILE = '61c4752c091f387bc2448d1c'
const PVE_PROFILE = '66979f1d05d30f2f7e0506cf'
const SEASON_PROFILE = '6a71207d270bc68f650dd124'
const QUEST_A = '5ae448bf86f7744d733e55ee'
const QUEST_B = '596a0e1686f7741ddf17dbee'

const app = (time: string, text: string) => `${time}|${V}|Info|application|${text}`
const backend = (time: string, host: string) => `${time}|${V}|Info|backend|---> Request HTTPS, id [1]: URL: https://${host}.escapefromtarkov.com/client/game/keepalive.`
const quest = (time: string, type: number, taskId: string) => `${time}|${V}|Info|push-notifications|Got notification | ChatMessageReceived
{
  "type": "new_message",
  "message": {
    "type": ${type},
    "templateId": "${taskId} ${type === 12 ? 'successMessageText' : 'description'}"
  }
}
${time}|${V}|Info|push-notifications|NotificationManager.ProcessMessage | Received notification: Type: ChatMessageReceived`

async function session(root: string, name: string, files: Record<string, string[]>) {
  const folder = join(root, name)
  await mkdir(folder, { recursive: true })
  for (const [file, lines] of Object.entries(files)) await writeFile(join(folder, `${name.slice(4)} ${file}_000.log`), lines.join('\n'))
}

describe('EFT log scanner', () => {
  it('splits one game launch into PvP and PvE by session mode, gateway and profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eft-modes-'))
    await session(root, 'log_2026.09.26_22-04-56_1.1.5.1.47510', {
      application: [
        app('2026-09-26 22:05:12.029', 'Session mode: Regular'),
        app('2026-09-26 22:05:40.937', 'Session mode: Pve'),
        app('2026-09-26 22:05:53.064', `CompleteSelectedProfile ProfileId:${PVE_PROFILE} AccountId:7690289`),
        app('2026-09-26 22:39:24.059', 'Session mode: Regular'),
        app('2026-09-26 22:39:34.919', `CompleteSelectedProfile ProfileId:${PVP_PROFILE} AccountId:7690289`),
      ],
      backend: [backend('2026-09-26 22:05:45.000', 'gw-pve'), backend('2026-09-26 22:39:30.000', 'gw-pvp')],
      'push-notifications': [quest('2026-09-26 22:08:12.000', 10, QUEST_A), quest('2026-09-26 22:44:19.000', 12, QUEST_B)],
    })
    const result = await scanLogFolderBySession(root)
    expect(result.eventsByMode.pve).toEqual([expect.objectContaining({ taskId: QUEST_A, status: 'active', profileId: PVE_PROFILE })])
    expect(result.eventsByMode.pvp).toEqual([expect.objectContaining({ taskId: QUEST_B, status: 'completed', profileId: PVP_PROFILE })])
    expect(result.eventsByMode.seasonal).toEqual([])
    expect(result.latestMode).toBe('pvp')
    expect(result.latestCharacterIdByMode).toEqual({ pvp: PVP_PROFILE, pve: PVE_PROFILE })
  })

  it('keeps the same quest separate in PvP and the season', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eft-season-'))
    await session(root, 'log_2026.09.17_23-16-36_1.1.5.0.47426', {
      application: [
        app('2026-09-17 23:16:50.714', 'Session mode: Regular'),
        app('2026-09-17 23:17:54.133', `CompleteSelectedProfile ProfileId:${PVP_PROFILE} AccountId:7690289`),
        app('2026-09-18 01:52:26.954', 'Session mode: PvpSeason'),
        app('2026-09-18 01:52:36.513', `CompleteSelectedProfile ProfileId:${SEASON_PROFILE} AccountId:7690289`),
      ],
      'push-notifications': [quest('2026-09-17 23:32:16.000', 12, QUEST_A), quest('2026-09-18 01:59:48.000', 10, QUEST_A)],
    })
    const result = await scanLogFolderBySession(root)
    expect(result.eventsByMode.pvp).toEqual([expect.objectContaining({ taskId: QUEST_A, status: 'completed' })])
    expect(result.eventsByMode.seasonal).toEqual([expect.objectContaining({ taskId: QUEST_A, status: 'active' })])
    expect(result.summaryByMode.pvp.resetAt).toBeUndefined()
  })

  it('detects a profile reset and drops everything before it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eft-reset-'))
    await session(root, 'log_2026.09.12_22-32-39_1.1.5.0.47242', {
      application: [app('2026-09-12 22:32:54.000', 'Session mode: Regular'), app('2026-09-12 22:33:30.000', `CompleteSelectedProfile ProfileId:${PVP_PROFILE} AccountId:7690289`)],
      'push-notifications': [quest('2026-09-13 00:04:33.000', 12, QUEST_A), quest('2026-09-13 00:05:00.000', 12, '5b47926a86f7747ccc057c15')],
    })
    await session(root, 'log_2026.09.26_22-04-56_1.1.5.1.47510', {
      application: [
        app('2026-09-26 22:47:05.791', 'Session mode: Regular'),
        app('2026-09-26 23:20:09.011', `CompleteSelectedProfile ProfileId:${PVP_PROFILE} AccountId:7690289`),
      ],
      'push-notifications': [quest('2026-09-26 23:22:18.000', 10, QUEST_B), quest('2026-09-26 23:25:05.000', 10, QUEST_A)],
    })
    const result = await scanLogFolderBySession(root)
    expect(result.eventsByMode.pvp.map((event) => [event.taskId, event.status])).toEqual([[QUEST_B, 'active'], [QUEST_A, 'active']])
    expect(result.summaryByMode.pvp.resetAt).toBe(new Date('2026-09-26T23:20:09.011').toISOString())
  })

  it('ignores flea market and trader messages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eft-other-'))
    await session(root, 'log_2026.09.27_16-00-10_1.1.5.1.47510', {
      application: [app('2026-09-27 16:00:25.532', 'Session mode: Regular')],
      'push-notifications': [quest('2026-09-27 16:38:22.777', 2, QUEST_A), quest('2026-09-27 16:39:00.000', 4, QUEST_B)],
    })
    const result = await scanLogFolderBySession(root)
    expect(result.events).toEqual([])
  })
})

describe('screenshot key from the game log', () => {
  const settings = (key: string) => `{"InvertedXAxis":false,"keyBindings":[{"keyName":"MakeScreenshot","variants":[{"keyCode":["${key}"]},{"keyCode":[]}],"pressType":"Press"}]}`

  it('reads the key the newest launch logged and follows a log that keeps growing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eft-keys-'))
    await session(root, 'log_2026.09.28_9-10-00_1.1.5.1.47510', { application: [app('2026-09-28 09:10:05.000', settings('Print'))] })
    await session(root, 'log_2026.09.29_20-31-00_1.1.5.1.47510', { application: [app('2026-09-29 20:31:05.123', settings('F12')), app('2026-09-29 20:31:06.000', 'Session mode: Regular')] })
    expect(await readScreenshotBinding(root)).toEqual(['F12'])
    const log = join(root, 'log_2026.09.29_20-31-00_1.1.5.1.47510', '2026.09.29_20-31-00_1.1.5.1.47510 application_000.log')
    await appendFile(log, `\n${app('2026-09-29 21:00:00.000', 'LocationLoaded:22.91 real:37.31 diff:14.4')}`)
    expect(await readScreenshotBinding(root)).toEqual(['F12'])
    await appendFile(log, `\n${app('2026-09-29 21:30:00.000', settings('Insert'))}`)
    expect(await readScreenshotBinding(root)).toEqual(['Insert'])
  })

  it('falls back to an older launch and answers null when nothing was logged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eft-keys-'))
    await session(root, 'log_2026.09.28_9-10-00_1.1.5.1.47510', { application: [app('2026-09-28 09:10:05.000', settings('F9'))] })
    await session(root, 'log_2026.09.29_20-31-00_1.1.5.1.47510', { application: [app('2026-09-29 20:31:06.000', 'Session mode: Regular')] })
    expect(await readScreenshotBinding(root)).toEqual(['F9'])
    expect(await readScreenshotBinding(await mkdtemp(join(tmpdir(), 'eft-empty-')))).toBeNull()
  })
})
