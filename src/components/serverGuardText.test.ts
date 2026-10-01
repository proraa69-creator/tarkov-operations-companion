import { describe, expect, it } from 'vitest'
import { ServerGuardian, type GuardDetail } from '../../electron/serverGuardian'
import { setRenderLanguage } from '../i18n/renderText'
import { watchdogText } from './serverStatusText'

/** Runs the guardian through every situation and collects what the owner can see (lamps, alerts, journal). */
async function everyGuardText() {
  let clock = Date.parse('2026-10-01T23:00:00Z')
  const texts: string[] = []
  const base = (): GuardDetail => ({
    uptimeSec: 600, requests: { last5m: { requests: 60, errors: 40, rate: 0.667 }, last15m: { requests: 60, errors: 40, rate: 0.667 }, last24h: { requests: 900, errors: 40, rate: 0.04 } },
    memory: { rssMb: 100 }, eventLoop: { p99Ms: 5 }, unhandled: { exceptions5m: 0 },
    database: { bytes: 1_000_000, quickCheck: { ok: false, at: '2026-10-01T22:00:00Z', result: 'database disk image is malformed' } },
    backups: { enabled: true, dir: 'C:\\Raid\\server\\backups' },
    security: { activeBans: 3, bans1h: 3, bans24h: 3, events1h: 9, events24h: 9, credentialStuffing1h: 1, lastBanAt: '2026-10-01T22:00:00Z', byReason24h: { scanner: 3, 'credential-stuffing': 2, traversal: 1, injection: 1, 'not-found': 1, 'auth-fail': 1, 'rate-limited': 1, 'login-fail': 1, 'webhook-signature': 1, oversized: 1 } },
  })
  let detail = base()
  let ok = false
  const guardian = new ServerGuardian({
    fetchDetail: async () => detail,
    backup: async () => (ok ? { ok: true, name: 'companion-daily-2026-10-01T23-00-00Z.sqlite' } : { ok: false, error: 'Резервная копия не создана: disk full' }),
    alert: (alert) => texts.push(alert.title, alert.body),
    note: (_service, _level, text) => texts.push(text),
    now: () => clock,
  })
  const round = async (ms: number) => { clock += ms; const verdict = await guardian.inspect(); for (const probe of [verdict.security, verdict.database]) if (probe && 'text' in probe && probe.text) texts.push(probe.text); for (const probe of [verdict.security, verdict.database]) if (probe && 'error' in probe && probe.error) texts.push(probe.error); if (verdict.restart) texts.push(verdict.restart) }
  await round(0)
  detail = { ...base(), security: { ...base().security, lastBanAt: '2026-10-01T23:00:10Z' } }
  await round(10_000)
  ok = true
  for (const change of [
    (d: GuardDetail) => { d.unhandled = { exceptions5m: 4 }; d.requests = {} },
    (d: GuardDetail) => { d.requests = {}; d.memory = { rssMb: 5000 } },
    (d: GuardDetail) => { d.requests = {}; d.memory = { rssMb: 2000 } },
  ]) { detail = base(); change(detail); await round(20 * 60_000) }
  for (let i = 0; i < 4; i += 1) guardian.noteApiRestart()
  detail = { ...base(), requests: {}, security: { activeBans: 1, events24h: 2 } }
  await round(3 * 60 * 60_000)
  detail = { ...base(), requests: {}, security: { events24h: 2 } }
  await round(10_000)
  detail = { ...base(), requests: {}, security: {} }
  await round(10_000)
  return texts
}

describe('«Страж сервера» texts', () => {
  it('every lamp, alert and journal line has an English version', async () => {
    const texts = await everyGuardText()
    expect(texts.length).toBeGreaterThan(15)
    setRenderLanguage('en')
    try {
      for (const text of texts) {
        const english = watchdogText(text, 'en')
        expect(english, text).not.toMatch(/[а-яё]/i)
      }
      expect(watchdogText('Безопасность', 'en')).toBe('Security')
    } finally {
      setRenderLanguage('ru')
    }
    expect(watchdogText(texts[0]!, 'ru')).toBe(texts[0])
  })
})
