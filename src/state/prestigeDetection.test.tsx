import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalProfile } from '../domain/progress'
import type { Quest, RaidMode } from '../domain/types'
import { buildScanResult, readLogSignals, traderQuestIdsForResets, type ModeLogScanResult } from '../import/eftLogTimeline'
import { applyScanToModes } from '../import/logApply'
import { logsCoverModes } from '../import/logCoverage'
import { updateLogStatus } from '../import/logStatus'
import { matchQuestsFromOcr } from '../import/questOcr'
import { tableMatches } from '../import/screenScanSync'
import { RU_TABLE_QUESTS, RU_TASKS_TABLE } from '../import/__fixtures__/russianTasksTable'
import { AppStateProvider, useAppState } from './AppState'
import { dismissModeResetNotice, useModeResetNotices } from './modeReset'

/**
 * Owner, 15.10.2026: «Не работает обнаружение квестов после сброса через кнопку престиж». The whole pipeline after
 * «Престиж +»: the game's log text → the scan the main process publishes → the app state; and a Tasks-table frame.
 */
const PVE_PROFILE = 'b'.repeat(24)
const PVP_PROFILE = 'c'.repeat(24)
// Trader quests of the catalog (hex ids: the logs name them), and the Tasks-table rows of the Russian fixture.
const STARTER = '5936d90786f7742b1420ba5b'
const SECOND = '5936d90786f7742b1420ba5c'
const THIRD = '5936d90786f7742b1420ba5d'
const LATER = '5936d90786f7742b1420ba5e'
const trader = (id: string, name: string): Quest => ({ id, name, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] } as unknown as Quest)
const quests: Quest[] = [
  trader(STARTER, 'Starter'), trader(SECOND, 'Second'), trader(THIRD, 'Third'), trader(LATER, 'Later'),
  ...RU_TABLE_QUESTS.map(([id, name]) => trader(id, name)),
]
const trustedQuestIds = { pvp: new Set(traderQuestIdsForResets(quests)), pve: new Set(traderQuestIdsForResets(quests)), seasonal: new Set(traderQuestIdsForResets(quests)) }

/** A log line at `ms` as EFT writes it: the PC's local time, no offset («2026-10-15 19:30:00.123|…»). */
function localLine(ms: number, text: string) {
  const d = new Date(ms)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}|1.2.0.0.47888|Info|application|${text}`
}
/** The same with the offset of a UTC+7 PC written out («… +07:00|»): the owner's time zone. */
function offsetLine(ms: number, text: string) {
  const d = new Date(ms + 7 * 3_600_000)
  const iso = d.toISOString().replace('T', ' ').replace('Z', '')
  return `${iso} +07:00|1.2.0.0.47888|Info|application|${text}`
}
const session = (line: typeof localLine, ms: number, mode: 'Pve' | 'Regular') => line(ms, `Session mode: ${mode}`)
const select = (line: typeof localLine, ms: number, profile: string) => line(ms, `SelectProfile ProfileId:${profile} AccountId:7690289`)
const quest = (line: typeof localLine, ms: number, taskId: string, type: 10 | 11 | 12) =>
  `${line(ms, 'Got notification | ChatMessageReceived')}\n{"message":{"type":${type},"templateId":"${taskId} 0"}}`

const H = 3_600_000
const T0 = Date.parse('2026-10-15T05:00:00Z')

/** What the main process publishes for these log texts (electron/logWatcher.ts). */
function scanOf(...texts: string[]): ModeLogScanResult {
  return buildScanResult(texts.flatMap((text) => readLogSignals(text)), texts.length, 0, { trustedQuestIds, oldestLaunchUntil: T0 - 1 })
}

const probe: { current?: ReturnType<typeof useAppState>; notices?: ReturnType<typeof useModeResetNotices> } = {}
function Probe() {
  const value = useAppState()
  const notices = useModeResetNotices()
  useEffect(() => { probe.current = value; probe.notices = notices })
  return null
}
const app = () => probe.current!
const statuses = (mode: RaidMode) => Object.fromEntries(Object.values(app().activeProfile.modes[mode].taskProgress).map((record) => [record.taskId, record.status]))
/** AppShell's application of a published scan (src/app/AppShell.tsx applyLogResult), and the status it keeps. */
function applyScan(scan: ModeLogScanResult) {
  updateLogStatus({ scan })
  act(() => applyScanToModes(scan, (mode) => app().activeProfile.modes[mode].registration, (mode, events, characterId, resetAt, characterSince) => app().applyLogScanForMode(mode, events, { characterId, resetAt, characterSince })))
}
/** A Tasks-table frame of the game in PvE, read twice (src/components/StoryScreenScanner.tsx). */
function readTasksTable() {
  const matches = tableMatches(RU_TASKS_TABLE, matchQuestsFromOcr(RU_TASKS_TABLE, quests))
  act(() => app().applyQuestScanForMode('pve', matches, quests, []))
  act(() => app().applyQuestScanForMode('pve', matches, quests, matches.map((match) => match.questId)))
}

beforeEach(() => {
  localStorage.clear()
  const profile = createLocalProfile('Оператор', 'local-test')
  profile.selectedMode = 'pve'
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  render(<AppStateProvider><Probe /></AppStateProvider>)
})
afterEach(() => {
  updateLogStatus({ scan: undefined })
  for (const notice of probe.notices ?? []) act(() => dismissModeResetNotice(notice.id))
})

for (const [zone, line] of [['local time', localLine], ['UTC+7 offset', offsetLine]] as const) {
  describe(`after «Престиж +», logs in ${zone}`, () => {
    const before = [
      session(line, T0, 'Pve'), select(line, T0 + 1000, PVE_PROFILE),
      quest(line, T0 + 60_000, STARTER, 10), quest(line, T0 + 120_000, STARTER, 12), quest(line, T0 + 180_000, SECOND, 10),
      session(line, T0 + H, 'Regular'), select(line, T0 + H + 1000, PVP_PROFILE), quest(line, T0 + H + 60_000, SECOND, 10),
    ].join('\n')

    it('an app-only press hides nothing: the logs bring every quest back at once, new lines add; the game\'s own reset drops the older ones', () => {
      const scan = scanOf(before)
      applyScan(scan)
      expect(statuses('pve')).toEqual({ [STARTER]: 'completed', [SECOND]: 'active' })
      expect(statuses('pvp')).toEqual({ [SECOND]: 'active' })
      const pvpBefore = JSON.stringify(app().activeProfile.modes.pvp)

      const pressedAt = T0 + 4 * H
      act(() => app().resetModeProgress('pve', new Date(pressedAt).toISOString(), 'prestige', { prestige: 1 }))
      // Owner, 15.10.2026: «нужно что бы приложение находило все актуальные на данный момент квесты, даже если просто
      // сделали сброс приложения, а в игре нет» — found again from the logs at once.
      expect(statuses('pve')).toEqual({ [STARTER]: 'completed', [SECOND]: 'active' })
      expect(app().activeProfile.modes.pve.resetMarker).toMatchObject({ kind: 'prestige' })
      // No press cuts into the logs: they still cover PvE's history (the Tasks table stays unneeded).
      expect(logsCoverModes(scan, quests, app().activeProfile.modes).pve).toBe(true)

      // The game logs more after the press, in the PC's local time.
      const after = [session(line, pressedAt + 60_000, 'Pve'), select(line, pressedAt + 61_000, PVE_PROFILE), quest(line, pressedAt + 120_000, THIRD, 10), quest(line, pressedAt + 180_000, LATER, 10), quest(line, pressedAt + 240_000, LATER, 12)].join('\n')
      applyScan(scanOf(before, after))
      expect(statuses('pve')).toEqual({ [STARTER]: 'completed', [SECOND]: 'active', [THIRD]: 'active', [LATER]: 'completed' })
      expect(app().activeProfile.modes.pve.resetMarker?.resolvedAt).toBeUndefined()

      // Then the game's own prestige: the first quest taken again after its hand-in (the trusted reset).
      const prestiged = [select(line, pressedAt + 2 * H, PVE_PROFILE), quest(line, pressedAt + 2 * H + 60_000, STARTER, 10)].join('\n')
      applyScan(scanOf(before, after, prestiged))
      expect(statuses('pve')).toEqual({ [STARTER]: 'active' })
      expect(app().activeProfile.modes.pve.resetMarker?.resolvedAt).toBeTruthy()
      // A Tasks-table frame: the rows the logs did not decide are taken.
      readTasksTable()
      expect(Object.keys(statuses('pve'))).toEqual(expect.arrayContaining([STARTER, ...RU_TABLE_QUESTS.map(([id]) => id).slice(0, 3)]))
      expect(JSON.stringify(app().activeProfile.modes.pvp)).toBe(pvpBefore)
    })

    it('the game\'s prestige request in the backend log is the game\'s own reset too', () => {
      applyScan(scanOf(before))
      const pressedAt = T0 + 4 * H
      act(() => app().resetModeProgress('pve', new Date(pressedAt).toISOString(), 'prestige', { prestige: 2 }))
      expect(statuses('pve')).toEqual({ [STARTER]: 'completed', [SECOND]: 'active' })
      const request = line(pressedAt + H, '---> Request HTTPS, id [42]: URL: https://gw-pve.escapefromtarkov.com/client/prestige/obtain, crc: .').replace('|application|', '|backend|')
      const fresh = quest(line, pressedAt + H + 60_000, THIRD, 10)
      const scan = scanOf(before, [request, fresh].join('\n'))
      expect(scan.summaryByMode.pve).toMatchObject({ resetVia: 'prestige' })
      applyScan(scan)
      expect(statuses('pve')).toEqual({ [THIRD]: 'active' })
      expect(app().activeProfile.modes.pve.resetMarker?.resolvedAt).toBe(new Date(pressedAt + H).toISOString())
    })
  })
}
