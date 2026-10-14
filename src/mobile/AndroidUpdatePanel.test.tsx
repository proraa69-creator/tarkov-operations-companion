import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The Android app's update card and its Settings row (owner, 13.10.2026: «автообновление внутри приложения»). */
const release = { versionCode: 600030, versionName: '0.6.0.30', url: 'https://raidos.app/download/android/raid-os-0.6.0.30.apk', sha256: 'b'.repeat(64), size: 31_457_280 }
const plugin = {
  info: vi.fn(async () => ({ versionCode: 600029, versionName: '0.6.0.29', canInstall: true, metered: false })),
  fetchManifest: vi.fn(async () => ({ status: 200, body: JSON.stringify(release) })),
  download: vi.fn(async () => ({ ready: true })),
  install: vi.fn(async () => ({ started: true })),
  openInstallSettings: vi.fn(async () => {}),
  cleanup: vi.fn(async () => {}),
  addListener: vi.fn(async () => ({ remove: async () => {} })),
}
vi.mock('@capacitor/core', async (importOriginal) => ({ ...(await importOriginal<typeof import('@capacitor/core')>()), registerPlugin: () => plugin }))
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: async () => {} }) } }))
vi.mock('../platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('../platform')>()), isAndroidApp: () => true }))

const { AndroidUpdateBanner, AndroidUpdateSettings } = await import('./AndroidUpdatePanel')
const { setRenderLanguage } = await import('../i18n/renderText')

afterEach(() => { cleanup(); setRenderLanguage('ru') })

describe('Android update card', () => {
  it('downloads the newer build at start and «Установить» opens Android\'s installer; Settings shows the same', async () => {
    render(<MemoryRouter initialEntries={['/']}><AndroidUpdateBanner /><AndroidUpdateSettings /></MemoryRouter>)
    expect(await screen.findByText('Обновление готово к установке')).toBeInTheDocument()
    expect(screen.getByText('Версия 0.6.0.30 · Android попросит подтвердить установку')).toBeInTheDocument()
    expect(screen.getByText(/Новая версия загружена 0\.6\.0\.30/)).toBeInTheDocument()
    expect(plugin.download).toHaveBeenCalledWith({ url: release.url, sha256: release.sha256, size: release.size, versionCode: 600030 })

    fireEvent.click(screen.getAllByRole('button', { name: 'Установить' })[0])
    await waitFor(() => expect(plugin.install).toHaveBeenCalledWith({ versionCode: 600030 }))
    expect(await screen.findByText(/Открыта установка…/)).toBeInTheDocument()
    // The installer is on top: no card.
    expect(screen.queryByRole('status')).toBeNull()

    // The automatic download switch is remembered.
    const toggle = screen.getByRole('switch', { name: 'Скачивать обновления автоматически' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(localStorage.getItem('raidos-android-auto-download-v1')).toBe('0')
    fireEvent.click(toggle)
  })

  it('stays off «Мини Карта» and speaks English', async () => {
    const { container } = render(<MemoryRouter initialEntries={['/live']}><AndroidUpdateBanner /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
    cleanup()
    setRenderLanguage('en')
    render(<MemoryRouter initialEntries={['/']}><AndroidUpdateSettings /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Download updates automatically' })).toBeInTheDocument()
    expect(screen.getByText('On Wi-Fi only. It installs after you tap «Install».')).toBeInTheDocument()
  })
})
