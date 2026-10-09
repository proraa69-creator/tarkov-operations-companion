import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../electron'
import { UpdateButton } from './UpdateButton'
import { AppUpdateSettings } from './AppUpdateSettings'

let status: UpdateStatus
let listener: (next: UpdateStatus) => void
const install = vi.fn(), settings = vi.fn(), setSettings = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  status = { state: 'available', version: '0.5.4', notify: true }
  settings.mockResolvedValue({ autoCheck: false, autoInstall: false })
  setSettings.mockImplementation(async patch => ({ autoCheck: false, autoInstall: false, ...patch }))
  install.mockImplementation(async () => status)
  window.tarkovDesktop = { getVersion: async () => '0.5.4', update: {
    status: async () => status, install, settings, setSettings,
    onStatus: (callback: (next: UpdateStatus) => void) => { listener = callback; return () => {} },
  } } as unknown as NonNullable<Window['tarkovDesktop']>
})
afterEach(() => { delete window.tarkovDesktop })
describe('desktop update controls', () => {
  it('offers the top bar button and shows the download window on click', async () => {
    render(<UpdateButton />)
    fireEvent.click(await screen.findByRole('button', { name: 'Обновить приложение' }))
    expect(install).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).toBeTruthy()
    act(() => listener({ state: 'downloading', version: '0.5.4', progress: 42 }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })
  it('opens a startup download already in progress when the UI mounts', async () => {
    status = { state: 'downloading', progress: 10, notify: false }
    render(<UpdateButton />)
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
  it('hides the notification button when notifications are disabled', async () => {
    status.notify = false
    render(<UpdateButton />)
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
    act(() => listener({ ...status, notify: true }))
    expect(screen.getByRole('button', { name: 'Обновить приложение' })).toBeTruthy()
  })
  it('allows startup automatic installation independently of notifications', async () => {
    render(<AppUpdateSettings />)
    const button = await screen.findByRole('switch', { name: 'Автообновление' })
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)
    expect(setSettings).toHaveBeenCalledWith({ autoInstall: true })
  })
})
