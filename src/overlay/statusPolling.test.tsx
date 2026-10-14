import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PositionSetupNotice } from './PositionSetupCard'
import { ExperimentalPage } from '../pages/ExperimentalPage'
import { reloadRemoteFeaturesForTests, setRemoteFeatures } from '../announcement/features'

vi.mock('../i18n/renderText', () => ({ uiText: (text: unknown) => text }))

// «Мини Карта» status (electron/experimental/index.ts `experimental:status`): each answer may read the registry and search
// the game's folders in the main process, so it is never asked on a timer while the game is in front.
const settings = { minimap: true, minimapOff: false, minimapOpacity: 0.9, minimapWidth: 420, playerMarker: 'arrow', itemKey: 'Semicolon', minimapKey: 'KeyM', collectorKey: '', screenshotKey: '', screenshotsDir: '' }
const status = { screenshotKey: { keys: ['Print'], source: 'standard', sendable: true, label: 'PrtSc' }, elevated: true, snipping: 'off', screenshotsFolder: 'screenshots', nativeError: '', gameKeys: 'visible', filesAfterPress: 0, lastPosition: null }
const api = { getSettings: vi.fn(), getStatus: vi.fn(), updateSettings: vi.fn(), toggleMinimap: vi.fn(), pickScreenshotsFolder: vi.fn() }

describe('minimap status polling', () => {
  let focus: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.useFakeTimers()
    // The owner's switch for every app on (src/announcement/features.ts).
    setRemoteFeatures({ minimap: true, minimapChangedAt: '' })
    focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.stubGlobal('tarkovDesktop', { experimental: api })
    api.getSettings.mockResolvedValue(settings)
    api.getStatus.mockResolvedValue(status)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    reloadRemoteFeaturesForTests()
  })

  const pass = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
  const toGame = async () => { focus.mockReturnValue(false); window.dispatchEvent(new Event('blur')); await pass(1) }
  const backToApp = async () => { focus.mockReturnValue(true); await act(async () => { window.dispatchEvent(new Event('focus')) }) }

  it('«Обзор»: asked when the page opens and when the player comes back, not every 30 s', async () => {
    render(<PositionSetupNotice />)
    await pass(0)
    expect(api.getStatus).toHaveBeenCalledTimes(1)
    await pass(10 * 60_000)
    expect(api.getStatus).toHaveBeenCalledTimes(1)
    await toGame()
    await pass(60 * 60_000)
    expect(api.getStatus).toHaveBeenCalledTimes(1)
    await backToApp()
    expect(api.getStatus).toHaveBeenCalledTimes(2)
  })

  it('«Мини Карта»: every 2 s while the window is in use, nothing while the game is in front', async () => {
    render(<ExperimentalPage />)
    await pass(0)
    expect(api.getStatus).toHaveBeenCalledTimes(1)
    await pass(4000)
    expect(api.getStatus).toHaveBeenCalledTimes(3)
    await toGame()
    await pass(30 * 60_000)
    expect(api.getStatus).toHaveBeenCalledTimes(3)
    await backToApp()
    expect(api.getStatus).toHaveBeenCalledTimes(4)
    await pass(2000)
    expect(api.getStatus).toHaveBeenCalledTimes(5)
  })
})
