import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../electron'

let listener: (next: UpdateStatus) => void = () => {}
const installerOffer = vi.fn(), installSetup = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  installerOffer.mockResolvedValue({ version: '0.6.0-214', size: 90_000_000 })
  installSetup.mockImplementation(() => new Promise<UpdateStatus>(() => {}))
  window.tarkovDesktop = { update: {
    status: async () => ({ state: 'idle' }), install: vi.fn(), settings: vi.fn(), setSettings: vi.fn(), installerOffer, installSetup,
    onStatus: (callback: (next: UpdateStatus) => void) => { listener = callback; return () => {} },
  } } as unknown as NonNullable<Window['tarkovDesktop']>
})
afterEach(() => { delete window.tarkovDesktop })

/** «Позже» lasts until the app closes (a module variable): every test starts with fresh modules, in Russian unless asked. */
async function offer(language: 'ru' | 'en' = 'ru') {
  vi.resetModules()
  ;(await import('../i18n/renderText')).setRenderLanguage(language)
  const { InstallerOffer } = await import('./InstallerOffer')
  return render(<InstallerOffer />)
}

// Owner, 03.11.2026: the window says only that Raid OS now installs like a regular program («это не нужно писать»).
describe('the portable exe\'s installer window (src/components/InstallerOffer.tsx)', () => {
  it('appears once the site publishes the installer, with «Установить» and «Позже» and no explanations', async () => {
    await offer()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toBe('Raid OSRaid OS теперь устанавливается как обычная программаУстановитьПозже')
  })

  it('in English too', async () => {
    await offer('en')
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toBe('Raid OSRaid OS now installs like a regular programInstallLater')
  })

  it('nothing while the installer is not published, in the installed app or in an older build', async () => {
    installerOffer.mockResolvedValue(null)
    const { container } = await offer()
    await waitFor(() => expect(installerOffer).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
    delete (window.tarkovDesktop!.update as { installerOffer?: unknown }).installerOffer
    await offer()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('«Установить» downloads with its progress; an error offers «Повторить»', async () => {
    let finish: (status: UpdateStatus) => void = () => {}
    installSetup.mockImplementationOnce(() => new Promise<UpdateStatus>((resolve) => { finish = resolve }))
    await offer()
    fireEvent.click(await screen.findByRole('button', { name: 'Установить' }))
    expect(installSetup).toHaveBeenCalledOnce()
    act(() => listener({ state: 'downloading', progress: 40, background: true }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
    expect(screen.queryByRole('button', { name: 'Позже' })).toBeNull()
    await act(async () => finish({ state: 'error', error: 'Сервер не отдал файл: HTTP 500' }))
    expect(screen.getByText('Сервер не отдал файл: HTTP 500')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(installSetup).toHaveBeenCalledTimes(2)
  })

  it('«Позже» closes it until the next start', async () => {
    const { unmount } = await offer()
    fireEvent.click(await screen.findByRole('button', { name: 'Позже' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()
    const { InstallerOffer } = await import('./InstallerOffer')
    render(<InstallerOffer />)
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(installerOffer).toHaveBeenCalledOnce()
  })
})
