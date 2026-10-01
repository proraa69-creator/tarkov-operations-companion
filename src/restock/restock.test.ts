import { describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/tradersResponse.json'
import {
  DEFAULT_RESTOCK_SETTINGS, dueNotifications, formatCountdown, msUntilRestock, nextNotificationDelay, nextRestock,
  notificationKey, pruneNotified, sanitizeRestockSettings, type TraderReset,
} from './restock'
import { adaptTradersResponse, fetchTraderResets, tradersQuery } from './restockSource'
import { readNotified, readRestockSettings, rememberNotified, writeRestockSettings } from './restockSettings'

const NOW = Date.parse('2026-10-01T12:00:00Z')
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
const traders: TraderReset[] = [
  { id: 'prapor', name: 'Прапор', resetTime: at(2) },
  { id: 'therapist', name: 'Терапевт', resetTime: at(10) },
  { id: 'skier', name: 'Лыжник', resetTime: at(-1) },
  { id: 'fence', name: 'Скупщик' },
]

describe('restock timers', () => {
  it('counts down and formats H:MM:SS', () => {
    expect(msUntilRestock(traders[0], NOW)).toBe(120_000)
    expect(msUntilRestock(traders[3], NOW)).toBeUndefined()
    expect(formatCountdown(65_000)).toBe('1:05')
    expect(formatCountdown(3_725_000)).toBe('1:02:05')
    expect(formatCountdown(-5)).toBe('0:00')
  })

  it('finds the next restock in the future, optionally among chosen traders', () => {
    expect(nextRestock(traders, NOW)?.trader.id).toBe('prapor')
    expect(nextRestock(traders, NOW, ['therapist', 'skier'])?.trader.id).toBe('therapist')
    expect(nextRestock([traders[2], traders[3]], NOW)).toBeUndefined()
  })
})

describe('restock notification scheduling', () => {
  const settings = { enabled: true, leadMinutes: 3, traderIds: ['prapor', 'therapist', 'skier'] }

  it('fires for chosen traders inside the lead time only', () => {
    const due = dueNotifications(traders, settings, NOW, new Set())
    expect(due.map((entry) => entry.trader.id)).toEqual(['prapor'])
    expect(due[0]).toMatchObject({ key: notificationKey('prapor', Date.parse(at(2))), minutesLeft: 2 })
  })

  it('does not repeat, skips passed restocks and respects the switch', () => {
    const key = notificationKey('prapor', Date.parse(at(2)))
    expect(dueNotifications(traders, settings, NOW, new Set([key]))).toEqual([])
    expect(dueNotifications(traders, { ...settings, enabled: false }, NOW, new Set())).toEqual([])
    expect(dueNotifications(traders, { ...settings, traderIds: ['skier'] }, NOW, new Set())).toEqual([])
  })

  it('fires the later trader once its window opens', () => {
    expect(dueNotifications(traders, settings, NOW + 6 * 60_000, new Set()).map((entry) => entry.trader.id)).toEqual([])
    expect(dueNotifications(traders, settings, NOW + 8 * 60_000, new Set()).map((entry) => entry.trader.id)).toEqual(['therapist'])
    expect(dueNotifications(traders, { ...settings, leadMinutes: 10 }, NOW, new Set()).map((entry) => entry.trader.id)).toEqual(['prapor', 'therapist'])
  })

  it('schedules the next check for the earliest pending window', () => {
    expect(nextNotificationDelay(traders, settings, NOW, new Set())).toBe(0)
    const notified = new Set([notificationKey('prapor', Date.parse(at(2)))])
    expect(nextNotificationDelay(traders, settings, NOW, notified)).toBe(7 * 60_000)
    expect(nextNotificationDelay(traders, { ...settings, enabled: false }, NOW, notified)).toBeUndefined()
  })

  it('sanitizes stored settings', () => {
    expect(sanitizeRestockSettings(null)).toEqual(DEFAULT_RESTOCK_SETTINGS)
    expect(sanitizeRestockSettings({ enabled: true, leadMinutes: 500, traderIds: ['a', 'a', 3, ''] })).toEqual({ enabled: true, leadMinutes: 60, traderIds: ['a'] })
    expect(sanitizeRestockSettings({ leadMinutes: 'x' }).leadMinutes).toBe(3)
  })

  it('prunes notified keys older than a day', () => {
    expect(pruneNotified([notificationKey('a', NOW - 25 * 3600_000), notificationKey('b', NOW), 'junk'], NOW)).toEqual([notificationKey('b', NOW)])
  })

  it('persists settings and notified restocks in localStorage', () => {
    localStorage.clear()
    expect(readRestockSettings()).toEqual(DEFAULT_RESTOCK_SETTINGS)
    writeRestockSettings({ enabled: true, traderIds: ['prapor'], leadMinutes: 5 })
    expect(readRestockSettings()).toEqual({ enabled: true, traderIds: ['prapor'], leadMinutes: 5 })
    expect(readRestockSettings()).toBe(readRestockSettings())
    rememberNotified([notificationKey('prapor', Date.now() + 1000)])
    expect(readNotified().size).toBe(1)
  })
})

describe('tarkov.dev traders adapter', () => {
  it('reads reset times and asks for the mode', async () => {
    const rows = adaptTradersResponse(fixture)
    expect(rows.find((row) => row.normalizedName === 'prapor')?.resetTime).toBe('2026-10-01T12:30:00.000Z')
    expect(rows.find((row) => row.normalizedName === 'lightkeeper')?.resetTime).toBeUndefined()
    expect(tradersQuery('pve', 'ru')).toContain('traders(gameMode: pve, lang: ru)')
    expect(tradersQuery('seasonal', 'en')).toContain('gameMode: regular')
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }))
    expect((await fetchTraderResets('pvp', 'ru', fetcher as unknown as typeof fetch)).length).toBe(rows.length)
  })
})
