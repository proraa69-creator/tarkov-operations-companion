import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerWatchdog, worstLamp, type ProbeResult, type WatchdogAlert } from './serverWatchdog'

/** A service whose probe answers whatever the test sets; `restart` counts calls. */
function harness(options: { threshold?: number; giveUpAfter?: number; enabled?: boolean } = {}) {
  let api: ProbeResult = { kind: 'ok' }
  let enabled = options.enabled ?? true
  const alerts: WatchdogAlert[] = []
  const restart = vi.fn(async () => {})
  const watchdog = new ServerWatchdog({
    enabled: () => enabled,
    services: { api: { label: 'Сервер (API)', probe: async () => api, restart, threshold: options.threshold, advice: 'Откройте журнал.' } },
    alert: (alert) => alerts.push(alert),
    giveUpAfter: options.giveUpAfter ?? 3,
  })
  return {
    watchdog, alerts, restart,
    set: (next: ProbeResult) => { api = next },
    setEnabled: (next: boolean) => { enabled = next },
    api: () => watchdog.snapshot().services.find((service) => service.id === 'api')!,
  }
}

/** Advances fake time and lets the scheduled checks and restarts finish. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('ServerWatchdog', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T10:00:00Z')) })
  afterEach(() => vi.useRealTimers())

  it('is green while the probe is ok and grey while the mode is off', async () => {
    const h = harness({ enabled: false })
    await h.watchdog.check()
    expect(h.api().lamp).toBe('grey')
    expect(h.watchdog.snapshot().enabled).toBe(false)
    h.setEnabled(true)
    await h.watchdog.check()
    expect(h.api()).toMatchObject({ lamp: 'green', text: 'работает', failures: 0 })
    expect(h.watchdog.snapshot().worst).toBe('green')
  })

  it('an advisory warning (tunnel connected, self-check through the internet fails) never alarms or restarts', async () => {
    const h = harness()
    h.set({ kind: 'warn', error: 'radios.app не открывается из интернета', advisory: true })
    for (let i = 0; i < 10; i += 1) await h.watchdog.check()
    await advance(10 * 60_000)
    expect(h.api()).toMatchObject({ lamp: 'amber', failures: 0 })
    expect(h.alerts).toHaveLength(0)
    expect(h.restart).not.toHaveBeenCalled()
  })

  it('needs 3 failed health checks in a row before restarting; one success resets the count', async () => {
    const h = harness()
    h.set({ kind: 'down', error: 'нет ответа' })
    await h.watchdog.check()
    await h.watchdog.check()
    expect(h.api()).toMatchObject({ lamp: 'amber', failures: 2 })
    h.set({ kind: 'ok' })
    await h.watchdog.check()
    expect(h.api().failures).toBe(0)
    h.set({ kind: 'down', error: 'нет ответа' })
    await h.watchdog.check(); await h.watchdog.check()
    expect(h.alerts).toHaveLength(0)
    await h.watchdog.check()
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['down'])
    expect(h.api().nextRetryAt).toBe(Date.now() + 5_000)
    expect(h.restart).not.toHaveBeenCalled()
    await advance(5_000)
    expect(h.restart).toHaveBeenCalledTimes(1)
  })

  it('restarts an exited process at once, with backoff 5 s, 15 s, 60 s, then every 5 min — never a tight loop', async () => {
    const h = harness()
    h.watchdog.start() // checks every 15 s
    await advance(0)
    h.set({ kind: 'down', error: 'Сервер остановился с кодом 1', dead: true })
    const restartTimes: number[] = []
    const start = Date.now()
    h.restart.mockImplementation(async () => { restartTimes.push(Date.now() - start) })
    await advance(30 * 60_000)
    h.watchdog.stop()
    const gaps = restartTimes.slice(1).map((time, index) => time - restartTimes[index])
    // First restart 5 s after the first failed check (15 s); later gaps grow and never drop below 15 s.
    expect(restartTimes[0]).toBe(15_000 + 5_000)
    expect(gaps[0]).toBeGreaterThanOrEqual(15_000)
    expect(gaps[1]).toBeGreaterThanOrEqual(60_000)
    for (const gap of gaps.slice(2)) expect(gap).toBeGreaterThanOrEqual(300_000)
    expect(restartTimes.length).toBeLessThanOrEqual(10)
  })

  it('tells the owner once per incident, once more when it gave up, and once when it is repaired', async () => {
    const h = harness({ giveUpAfter: 2 })
    h.watchdog.start()
    await advance(0)
    h.set({ kind: 'down', error: 'exit 1', dead: true })
    await advance(10 * 60_000)
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['down', 'gave-up'])
    expect(h.alerts[1].body).toContain('Откройте журнал.')
    expect(h.api().lamp).toBe('red')
    h.set({ kind: 'ok' })
    await advance(15_000)
    h.watchdog.stop()
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['down', 'gave-up', 'repaired'])
    expect(h.alerts[2].title).toBe('Сервер перезапущен автоматически')
    expect(h.api()).toMatchObject({ lamp: 'green', attempts: 0, failures: 0 })
    expect(h.api().lastError).toBeUndefined()
  })

  it('does not spam: a flapping service notifies «down» at most once per cooldown and its recovery only when told', async () => {
    const h = harness({ threshold: 1 })
    for (let round = 0; round < 4; round += 1) {
      h.set({ kind: 'down', error: 'нет ответа' })
      await h.watchdog.check()
      h.set({ kind: 'ok' })
      await h.watchdog.check()
      await advance(60_000)
    }
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['down', 'recovered'])
    await advance(10 * 60_000)
    h.set({ kind: 'down', error: 'нет ответа' })
    await h.watchdog.check()
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['down', 'recovered', 'down'])
  })

  it('a port taken by another program is reported once and never restarted', async () => {
    const h = harness()
    h.set({ kind: 'blocked', error: 'Порт 8787 занят другой программой.' })
    for (let index = 0; index < 5; index += 1) { await h.watchdog.check(); await advance(15_000) }
    expect(h.restart).not.toHaveBeenCalled()
    expect(h.api().lamp).toBe('red')
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['blocked'])
  })

  it('network warnings stay amber until they repeat', async () => {
    const h = harness()
    h.set({ kind: 'warn', error: 'timeout' })
    await h.watchdog.check(); await h.watchdog.check()
    expect(h.api().lamp).toBe('amber')
    expect(h.alerts).toHaveLength(0)
    await h.watchdog.check()
    expect(h.alerts.map((alert) => alert.kind)).toEqual(['down'])
  })

  it('a manual restart works at any time and is written to the journal (newest first, at most 50)', async () => {
    const h = harness()
    await h.watchdog.check()
    for (let index = 0; index < 60; index += 1) await h.watchdog.restartNow('api')
    const { events } = h.watchdog.snapshot()
    expect(h.restart).toHaveBeenCalledTimes(60)
    expect(events).toHaveLength(50)
    expect(events[0].text).toContain('перезапуск вручную')
  })

  it('the worst lamp wins, grey only when nothing else is known', () => {
    expect(worstLamp(['green', 'grey', 'amber'])).toBe('amber')
    expect(worstLamp(['green', 'red', 'amber'])).toBe('red')
    expect(worstLamp(['grey', 'grey'])).toBe('grey')
  })
})

describe('ServerWatchdog when the mode is switched off', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it('a planned restart does not run after the owner switched the server off', async () => {
    const h = harness({ threshold: 1 })
    h.set({ kind: 'down', error: 'нет ответа' })
    await h.watchdog.check()
    expect(h.api().nextRetryAt).toBeDefined()
    h.setEnabled(false)
    await advance(10_000)
    expect(h.restart).not.toHaveBeenCalled()
    await h.watchdog.check()
    expect(h.api().lamp).toBe('grey')
  })
})
