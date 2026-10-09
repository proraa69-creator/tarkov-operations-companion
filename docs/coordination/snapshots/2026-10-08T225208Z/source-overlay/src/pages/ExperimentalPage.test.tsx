import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ExperimentalPage } from './ExperimentalPage'

vi.mock('../i18n/renderText', () => ({ uiText: (text: unknown) => text }))
const settings = { minimapOpacity: 0.9, minimapWidth: 420, playerMarker: 'arrow', itemKey: 'Semicolon', minimapKey: 'KeyM', collectorKey: '', screenshotKey: '', screenshotsDir: '' }
const api = {
  getSettings: vi.fn(), getStatus: vi.fn(), updateSettings: vi.fn(), toggleMinimap: vi.fn(), pickScreenshotsFolder: vi.fn(),
}
beforeEach(() => {
  vi.stubGlobal('tarkovDesktop', { experimental: api })
  api.getSettings.mockResolvedValue(settings)
  api.getStatus.mockResolvedValue({ screenshotKey: { keys: [], source: 'default', sendable: true, label: 'Home' }, elevated: true, screenshotsFolder: 'screenshots', nativeError: '' })
  api.updateSettings.mockImplementation(async (patch) => ({ ...settings, ...patch }))
  api.toggleMinimap.mockResolvedValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals() })
it('persists the map size and sends the manual toggle command', async () => {
  render(<ExperimentalPage />)
  await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
  fireEvent.change(screen.getByRole('slider', { name: 'Размер мини-карты' }), { target: { value: '520' } })
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ minimapWidth: 520 }))
  fireEvent.click(screen.getByRole('button', { name: 'Показать / скрыть мини-карту' }))
  await waitFor(() => expect(api.toggleMinimap).toHaveBeenCalledOnce())
})
it('shows a failed command instead of ignoring the click', async () => {
  api.toggleMinimap.mockRejectedValue(new Error('Overlay failed'))
  render(<ExperimentalPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Показать / скрыть мини-карту' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Overlay failed')
})
