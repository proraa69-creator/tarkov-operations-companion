import { afterEach, describe, expect, it } from 'vitest'
import { acceptStep, guideFinished, guideForAccount, guideStepFor, isNewAccount, NEW_ACCOUNT_MS, readGuide, restartGuide } from './guideProgress'

const NOW = new Date('2026-10-12T12:00:00Z')
const account = (createdAt: string | undefined, extra: object = {}) => ({ signedIn: true, email: 'Player@Example.com', online: true, serverUrl: 'https://raidos.app', persistent: true, createdAt, ...extra })
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

afterEach(() => localStorage.clear())

describe('first-run guide: who gets it', () => {
  it('is for an account registered within a week, or one whose free day waits for its first app sign-in', () => {
    expect(isNewAccount(account(daysAgo(0)), NOW.getTime())).toBe(true)
    expect(isNewAccount(account(daysAgo(6.9)), NOW.getTime())).toBe(true)
    expect(isNewAccount(account(new Date(NOW.getTime() - NEW_ACCOUNT_MS - 1000).toISOString()), NOW.getTime())).toBe(false)
    expect(isNewAccount(account(undefined), NOW.getTime())).toBe(false)
    // Registered on the website long ago, signing in to an app for the first time now.
    expect(isNewAccount(account(daysAgo(40), { subscription: { status: 'inactive', trialPendingDays: 1 } }), NOW.getTime())).toBe(true)
  })

  it('starts for a new account (kept per e-mail on this computer) and stores nothing for an older one', () => {
    expect(guideForAccount(account(daysAgo(40)), NOW)).toBeNull()
    expect(localStorage.length).toBe(0)
    expect(guideForAccount({ ...account(daysAgo(1)), signedIn: false }, NOW)).toBeNull()
    const started = guideForAccount(account(daysAgo(1)), NOW)
    expect(started).toEqual({ email: 'Player@Example.com', record: { started: NOW.toISOString(), accepted: [] } })
    expect(readGuide('player@example.com')).toEqual({ started: NOW.toISOString(), accepted: [] })
    // A week later the guide goes on where it stopped.
    acceptStep('player@example.com', 'quests')
    expect(guideForAccount(account(daysAgo(9)), new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000))?.record.accepted).toEqual(['quests'])
  })

  it('«Показать снова» brings every tip back, for an account of any age', () => {
    restartGuide('veteran@example.com', NOW)
    expect(guideForAccount({ ...account(daysAgo(400)), email: 'veteran@example.com' }, NOW)?.record.accepted).toEqual([])
  })
})

describe('first-run guide: sections', () => {
  it('maps the sections to their tips; the phone has no story sync; no «Мини Карта» tip (no overlays)', () => {
    expect(guideStepFor('/quests', false)).toBe('quests')
    expect(guideStepFor('/experimental', false)).toBeNull()
    expect(guideStepFor('/maps', false)).toBe('maps')
    expect(guideStepFor('/maps/customs', true)).toBe('maps')
    expect(guideStepFor('/kappa-items', true)).toBe('kappa')
    expect(guideStepFor('/quests', true)).toBeNull()
    expect(guideStepFor('/', false)).toBeNull()
  })

  it('remembers each «Принял» once and knows when the guide is over', () => {
    restartGuide('player@example.com', NOW)
    for (const step of ['maps', 'kappa', 'maps'] as const) acceptStep('player@example.com', step)
    const record = readGuide('player@example.com')!
    expect(record.accepted).toEqual(['maps', 'kappa'])
    expect(guideFinished(record, true)).toBe(true)
    expect(guideFinished(record, false)).toBe(false)
  })
})
