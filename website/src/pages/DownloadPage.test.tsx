import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setSiteLocale } from '../i18n'
import { resetSetupPublishedForTests } from '../hooks/setupDownload'
import { DownloadButton, DownloadPage } from './DownloadPage'

/** «Скачать для Windows»: the installer once the release publishes it (owner, 03.11.2026), the portable exe until then. */
const manifest = { version: '0.6.0-214', build: 1793700000000, commit: 'abc', edition: 'client', size: 90_000_000, sha256: 'ab'.repeat(32), signature: `${'A'.repeat(86)}==` }

describe('the Windows download', () => {
  beforeEach(() => resetSetupPublishedForTests())
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); setSiteLocale('ru', { remember: false }) })

  it('hands out the installer when its manifest is published', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(manifest)))
    render(<MemoryRouter><DownloadPage /></MemoryRouter>)
    const button = screen.getByRole('link', { name: 'Скачать для Windows' })
    await waitFor(() => expect(button).toHaveAttribute('href', '/downloads/RaidOSSetup.exe'))
    expect(button).toHaveAttribute('download', 'RaidOSSetup.exe')
    expect(screen.getByText('Установщик для Windows — выберите папку для приложения.')).toBeInTheDocument()
  })

  it('the portable exe while there is none: the site answers with its page, or nothing at all', async () => {
    for (const answer of [async () => new Response('<!doctype html><div id="root"></div>', { headers: { 'content-type': 'text/html' } }), async () => { throw new TypeError('offline') }]) {
      resetSetupPublishedForTests()
      const fetchMock = vi.fn(answer)
      vi.stubGlobal('fetch', fetchMock)
      render(<DownloadButton />)
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      await Promise.resolve()
      const button = screen.getByRole('link', { name: 'Скачать для Windows' })
      expect(button).toHaveAttribute('href', '/download/windows')
      expect(button).toHaveAttribute('download', 'RaidOSClient.exe')
      cleanup()
    }
  })

  it('in English too', async () => {
    setSiteLocale('en', { remember: false })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(manifest)))
    render(<MemoryRouter><DownloadPage /></MemoryRouter>)
    expect(await screen.findByText('Installer for Windows: choose a folder for the app.')).toBeInTheDocument()
  })
})
