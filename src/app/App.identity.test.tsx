import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

/**
 * Which screen reader runs (audit P4a): while the app is locked — sign-in, subscription — only the identity reader of the
 * game's start screens; once it is unlocked, the scanner (which applies what the identity reader kept), never both.
 */
const access = vi.hoisted(() => ({ value: { state: 'locked', reason: 'signed-out' } as { state: string; reason?: string } }))
vi.mock('../account/dataAccess', () => ({ useDataAccess: () => access.value }))
vi.mock('../platform', async (original) => ({ ...(await original<typeof import('../platform')>()), isDesktopShell: () => true }))
vi.mock('../components/IdentityScreenReader', () => ({ IdentityScreenReader: () => <i data-testid="identity-reader" /> }))
vi.mock('../components/StoryScreenScanner', () => ({ StoryScreenScanner: () => <i data-testid="quest-scanner" /> }))
vi.mock('../account/Paywall', () => ({ Paywall: () => <i data-testid="paywall" />, DeviceLimitNotice: () => null }))
vi.mock('./AppShell', () => ({ AppShell: () => <i data-testid="app-shell" /> }))
vi.mock('../components/QuestChecksRaidReset', () => ({ QuestChecksRaidReset: () => null }))
vi.mock('../components/ExperimentalBridge', () => ({ ExperimentalBridge: () => null }))
vi.mock('../account/EftAccountBinding', () => ({ EftAccountBinding: () => null }))
vi.mock('../onboarding/GameRestartNotice', () => ({ GameRestartNotice: () => null }))
vi.mock('../onboarding/FirstRunGuide', () => ({ FirstRunGuide: () => null }))
vi.mock('../onboarding/QuestSyncTip', () => ({ QuestSyncTip: () => null }))
vi.mock('../onboarding/RaidLoadoutTip', () => ({ RaidLoadoutTip: () => null }))
vi.mock('../restock/RestockWidgets', () => ({ RestockNotifier: () => null }))
vi.mock('../components/UpdateButton', () => ({ UpdateButton: () => null }))
vi.mock('../announcement/AnnouncementBanner', () => ({ AnnouncementBanner: () => null }))
vi.mock('../components/UiSounds', () => ({ UiSounds: () => null }))
const { App } = await import('./App')
const { LocaleProvider } = await import('../i18n/LocaleProvider')

const renderApp = () => render(<LocaleProvider><MemoryRouter><App /></MemoryRouter></LocaleProvider>)
afterEach(cleanup)

describe('screen readers by the app\'s lock (audit P4a)', () => {
  it('locked: the identity reader alone', () => {
    access.value = { state: 'locked', reason: 'signed-out' }
    renderApp()
    expect(screen.getByTestId('paywall')).toBeTruthy()
    expect(screen.getByTestId('identity-reader')).toBeTruthy()
    expect(screen.queryByTestId('quest-scanner')).toBeNull()
  })

  it('checking the subscription at start: the identity reader alone too', () => {
    access.value = { state: 'checking' }
    renderApp()
    expect(screen.getByTestId('identity-reader')).toBeTruthy()
    expect(screen.queryByTestId('quest-scanner')).toBeNull()
  })

  it('unlocked: the scanner, no identity reader', () => {
    access.value = { state: 'granted' }
    renderApp()
    expect(screen.getByTestId('quest-scanner')).toBeTruthy()
    expect(screen.queryByTestId('identity-reader')).toBeNull()
  })
})
