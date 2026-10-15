import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../electron'
import { UpdateButton } from './UpdateButton'
import { AppUpdateSettings } from './AppUpdateSettings'
import { setRenderLanguage } from '../i18n/renderText'

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
  it('the owner\'s copy with a signed owner exe on the server: the same «Обновить приложение» and update window as players', async () => {
    // electron/appUpdate.ts: a verified owner manifest makes it a normal update (no ownerExe).
    status = { state: 'available', version: '0.6.1', notify: true }
    render(<UpdateButton />)
    const button = await screen.findByRole('button', { name: 'Обновить приложение' })
    expect(button.getAttribute('title')).not.toContain('админ-панели')
    fireEvent.click(button)
    expect(install).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Обновление до актуальной версии')).toBeTruthy()
    act(() => listener({ state: 'downloading', version: '0.6.1', progress: 37 }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '37')
    act(() => listener({ state: 'downloading', version: '0.6.1', progress: 100, phase: 'verifying' }))
    expect(screen.getByText('Проверка файла (размер и подпись SHA-256)')).toBeTruthy()
    act(() => listener({ state: 'error', version: '0.6.1', error: 'Файл обновления повреждён, попробуйте ещё раз' }))
    expect(screen.getByRole('button', { name: 'Повторить обновление' })).toBeTruthy()
    expect(screen.getAllByText('Файл обновления повреждён, попробуйте ещё раз').length).toBeGreaterThan(0)
  })
  it('the fallback (no signed owner exe on the server): «Скачать новую версию» opens the admin panel, no download window', async () => {
    status = { state: 'available', version: '0.6.0-29', notify: true, ownerExe: true }
    render(<UpdateButton />)
    const button = await screen.findByRole('button', { name: 'Скачать новую версию' })
    expect(button.getAttribute('title')).toContain('«Raid OS Server.exe»')
    expect(button.getAttribute('title')).toContain('подписанной серверной версии на сервере пока нет')
    fireEvent.click(button)
    expect(install).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('English: the owner\'s in-app update, its errors and the fallback', async () => {
    setRenderLanguage('en')
    try {
      status = { state: 'error', version: '0.6.1', notify: true, error: 'Войдите в аккаунт владельца, чтобы скачать обновление' }
      const { unmount } = render(<UpdateButton />)
      const retry = await screen.findByRole('button', { name: 'Retry update' })
      expect(retry.getAttribute('title')).toBe('Sign in to the owner account to download the update')
      unmount()
      status = { state: 'available', version: '0.6.1', notify: true, ownerExe: true }
      render(<UpdateButton />)
      const fallback = await screen.findByRole('button', { name: 'Download the new version' })
      expect(fallback.getAttribute('title')).toContain('the server has no signed server version yet')
    } finally {
      setRenderLanguage('ru')
    }
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
  it('the fallback: settings say where the owner\'s whole exe is and the button opens the admin panel', async () => {
    status = { state: 'available', version: '0.6.0-29', notify: true, ownerExe: true }
    render(<AppUpdateSettings />)
    expect(await screen.findByText(/скачайте «Raid OS Server\.exe» в админ-панели, раздел «Серверная версия»/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Открыть админ-панель/ }))
    expect(install).toHaveBeenCalledOnce()
  })
})
