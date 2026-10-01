import { describe, expect, it } from 'vitest'
import { GUARD_THRESHOLDS, ServerGuardian, type GuardDetail, type GuardianAlert } from './serverGuardian'
import { ServerWatchdog } from './serverWatchdog'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

function healthy(): GuardDetail {
  return {
    uptimeSec: 600,
    requests: { last5m: { requests: 300, errors: 0, rate: 0 }, last15m: { requests: 900, errors: 1, rate: 0.001 }, last24h: { requests: 20_000, errors: 3, rate: 0 } },
    eventLoop: { meanMs: 11, p99Ms: 25, maxMs: 40 },
    memory: { rssMb: 140, heapUsedMb: 60 },
    unhandled: { total: 0, exceptions5m: 0, rejections5m: 0 },
    database: { bytes: 5 * 1024 * 1024, quickCheck: { ok: true, at: '2026-10-01T09:00:00.000Z', result: 'ok' } },
    backups: { enabled: true, dir: 'C:\\Users\\owner\\AppData\\Roaming\\Tarkov Operator\\server\\backups', lastAt: '2026-10-01T03:00:00.000Z', count: 5 },
    security: { activeBans: 0, bans1h: 0, bans24h: 0, events1h: 0, events24h: 0, credentialStuffing1h: 0 },
  }
}

function harness(start = Date.parse('2026-10-01T10:00:00Z')) {
  let clock = start
  let detail: GuardDetail | null = healthy()
  const alerts: GuardianAlert[] = []
  const notes: Array<{ service: string; level: string; text: string }> = []
  const backups: string[] = []
  let backupResult: { ok: true; name: string } | { ok: false; error: string } = { ok: true, name: 'companion-x.sqlite' }
  const guardian = new ServerGuardian({
    fetchDetail: async () => detail,
    backup: async (kind) => { backups.push(kind); return backupResult },
    alert: (alert) => alerts.push(alert),
    note: (service, level, text) => notes.push({ service, level, text }),
    now: () => clock,
    day: (at) => new Date(at).toISOString().slice(0, 10),
  })
  return {
    guardian, alerts, notes, backups,
    set: (change: (detail: GuardDetail) => void) => { detail = healthy(); change(detail) },
    offline: () => { detail = null },
    failBackups: (error: string) => { backupResult = { ok: false, error } },
    /** The next watchdog round (the verdict is cached for 5 s). */
    round: async (ms = 15_000) => { clock += ms; return guardian.inspect() },
  }
}

describe('ServerGuardian', () => {
  it('normal traffic: no restart, no alerts, green «Безопасность»', async () => {
    const h = harness()
    for (let i = 0; i < 20; i += 1) {
      const verdict = await h.round()
      expect(verdict.restart).toBeUndefined()
      expect(verdict.database).toBeUndefined()
      expect(verdict.security).toMatchObject({ kind: 'report', lamp: 'green' })
    }
    expect(h.alerts).toEqual([])
    expect(h.backups).toEqual([])
  })

  it('a high 5xx rate restarts the API with a backup first; cooldown and a cap prevent a restart loop', async () => {
    const h = harness()
    h.set((d) => { d.requests!.last5m = { requests: 60, errors: 40, rate: 0.667 } })
    const first = await h.round()
    expect(first.restart).toMatch(/40 ответов 5xx из 60/)
    expect(h.backups).toEqual(['before-restart'])
    expect(h.notes.some((note) => /Копия базы перед перезапуском: companion-x\.sqlite/.test(note.text))).toBe(true)
    // Within 15 minutes: no second restart even though it is still bad.
    expect((await h.round(5 * MINUTE)).restart).toBeUndefined()
    expect((await h.round(11 * MINUTE)).restart).toBeDefined()
    expect((await h.round(16 * MINUTE)).restart).toBeDefined()
    // Fourth time within 6 hours: paused, the owner is told once.
    expect((await h.round(16 * MINUTE)).restart).toBeUndefined()
    expect((await h.round(16 * MINUTE)).restart).toBeUndefined()
    expect(h.alerts.filter((alert) => alert.kind === 'restarts-paused')).toHaveLength(1)
    expect(h.backups).toEqual(['before-restart', 'before-restart', 'before-restart'])
  })

  it('a few errors among many requests do not restart; a spike only notifies (rate-limited)', async () => {
    const h = harness()
    h.set((d) => { d.requests!.last5m = { requests: 2000, errors: 25, rate: 0.0125 } })
    expect((await h.round()).restart).toBeUndefined()
    h.set((d) => { d.requests!.last15m = { requests: 50, errors: 15, rate: 0.3 } })
    expect((await h.round()).restart).toBeUndefined()
    await h.round()
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['errors'])
    await h.round(31 * MINUTE)
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['errors', 'errors'])
  })

  it('event-loop stall needs several rounds; memory limit and growth restart; a new process resets the baseline', async () => {
    const h = harness()
    h.set((d) => { d.eventLoop!.p99Ms = 1500 })
    expect((await h.round()).restart).toBeUndefined()
    expect((await h.round()).restart).toBeUndefined()
    expect((await h.round()).restart).toMatch(/подвисает/)

    const m = harness()
    m.set((d) => { d.memory!.rssMb = 300 })
    await m.round()
    m.set((d) => { d.memory!.rssMb = 700; d.uptimeSec = 900 })
    expect((await m.round()).restart).toBeUndefined()
    m.set((d) => { d.memory!.rssMb = 910; d.uptimeSec = 1000 })
    expect((await m.round()).restart).toMatch(/300 → 910/)
    // After the restart the new process starts at 900 MB: that is its baseline, not growth.
    m.set((d) => { d.memory!.rssMb = 900; d.uptimeSec = 5 })
    expect((await m.round(20 * MINUTE)).restart).toBeUndefined()
    m.set((d) => { d.memory!.rssMb = GUARD_THRESHOLDS.memoryLimitMb + 10; d.uptimeSec = 60 })
    expect((await m.round()).restart).toMatch(/слишком много памяти/)
  })

  it('repeated unhandled exceptions restart the API', async () => {
    const h = harness()
    h.set((d) => { d.unhandled!.exceptions5m = 3 })
    expect((await h.round()).restart).toMatch(/Необработанные ошибки/)
  })

  it('daily backup: when the last one is older than a day; a failure notifies and retries in an hour', async () => {
    const h = harness(Date.parse('2026-10-02T04:00:00Z'))
    await h.round()
    expect(h.backups).toEqual(['daily'])
    expect(h.notes.some((note) => /ежедневная резервная копия/.test(note.text))).toBe(true)
    h.failBackups('Резервная копия не создана: disk full')
    await h.round(30 * MINUTE)
    expect(h.backups).toEqual(['daily'], 'a retry waits an hour')
    await h.round(31 * MINUTE)
    expect(h.backups).toEqual(['daily', 'daily'])
    expect(h.alerts.filter((alert) => alert.kind === 'backup')).toHaveLength(1)
    await h.round(HOUR)
    expect(h.alerts.filter((alert) => alert.kind === 'backup')).toHaveLength(1)
    // A fresh copy: nothing more to do.
    const fresh = harness()
    await fresh.round()
    expect(fresh.backups).toEqual([])
  })

  it('quick_check failure: red database lamp, restore instructions, never an automatic restore', async () => {
    const h = harness()
    h.set((d) => { d.database!.quickCheck = { ok: false, at: '2026-10-01T10:00:00.000Z', result: 'database disk image is malformed' } })
    const verdict = await h.round()
    expect(verdict.database).toMatchObject({ kind: 'report', lamp: 'red' })
    const alert = h.alerts.find((item) => item.kind === 'database')!
    expect(alert.body).toMatch(/Автоматически ничего не восстанавливается/)
    expect(alert.body).toMatch(/server\\backups/)
    expect(alert.body).toMatch(/docs\/server-guard\.md/)
    await h.round()
    expect(h.alerts.filter((item) => item.kind === 'database')).toHaveLength(1)
    expect(h.backups).toEqual([])
    expect(verdict.restart).toBeUndefined()
  })

  it('attacks: one summary notification, not one per ban; lamp amber / red', async () => {
    const h = harness()
    h.set((d) => { d.security = { activeBans: 1, bans1h: 0, bans24h: 1, events1h: 0, lastBanAt: '2026-10-01T08:00:00.000Z' } })
    await h.round()
    expect(h.alerts).toEqual([], 'bans from before the app started are not news')
    h.set((d) => { d.security = { activeBans: 2, bans1h: 1, events1h: 5, lastBanAt: '2026-10-01T10:00:20.000Z', byReason24h: { scanner: 40 } } })
    const amber = await h.round()
    expect(amber.security).toMatchObject({ kind: 'report', lamp: 'amber' })
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['attack'])
    expect(h.alerts[0]!.body).toMatch(/сканирование уязвимостей/)
    h.set((d) => { d.security = { activeBans: 5, bans1h: 4, events1h: 50, credentialStuffing1h: 2, lastBanAt: '2026-10-01T10:01:00.000Z', byReason24h: { 'credential-stuffing': 12, scanner: 40 } } })
    const red = await h.round()
    expect(red.security).toMatchObject({ kind: 'report', lamp: 'red' })
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['attack'], 'rate-limited')
    expect(h.notes.filter((note) => note.service === 'security' && /заблокирован/.test(note.text))).toHaveLength(2)
  })

  it('crash loop: 4 API starts within 30 minutes notify once', () => {
    const h = harness()
    for (let i = 0; i < 6; i += 1) h.guardian.noteApiRestart()
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['crash-loop'])
  })

  it('writes one summary line per day to the journal', async () => {
    const h = harness(Date.parse('2026-10-01T23:50:00Z'))
    await h.round()
    expect(h.notes.filter((note) => /Сводка за сутки/.test(note.text))).toHaveLength(0)
    await h.round(15 * MINUTE)
    await h.round()
    const summary = h.notes.filter((note) => /Сводка за сутки/.test(note.text))
    expect(summary).toHaveLength(1)
    expect(summary[0]!.text).toMatch(/запросов 20000, ошибок 5xx 3/)
  })

  it('no detail (an older server): grey lamp, nothing else', async () => {
    const h = harness()
    h.offline()
    const verdict = await h.round()
    expect(verdict.security.kind).toBe('unknown')
    expect(verdict.restart).toBeUndefined()
  })
})

describe('ServerWatchdog report lamps and notes', () => {
  it('shows a report-only lamp as is and keeps journal notes', async () => {
    let lamp: 'green' | 'amber' | 'red' = 'red'
    const alerts: unknown[] = []
    const watchdog = new ServerWatchdog({
      enabled: () => true,
      services: { security: { label: 'Безопасность', probe: async () => ({ kind: 'report', lamp, text: 'атака', error: 'подробности' }), notify: false } },
      alert: (alert) => alerts.push(alert),
    })
    await watchdog.check()
    expect(watchdog.snapshot().services[0]).toMatchObject({ id: 'security', lamp: 'red', text: 'атака', lastError: 'подробности', attempts: 0 })
    expect(watchdog.snapshot().worst).toBe('red')
    lamp = 'green'
    await watchdog.check()
    expect(watchdog.snapshot().services[0]).toMatchObject({ lamp: 'green' })
    watchdog.note('security', 'info', 'Сводка за сутки: …')
    expect(watchdog.snapshot().events[0]).toMatchObject({ service: 'security', text: 'Сводка за сутки: …' })
    expect(alerts).toEqual([])
    watchdog.stop()
  })
})
