import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setSiteLocale } from '../i18n'
import { resetSetupPublishedForTests } from '../hooks/setupDownload'
import { PcAppPage } from './PcAppPage'

/**
 * raidos.app/pc — what the iPhone app links to (owner, 09.11.2026: «Скачайте наше приложение для ПК»): the download only.
 * Apple's reviewer opens the link; outside the United States storefront it must not lead to paying (guideline 3.1.1(a)).
 */
describe('raidos.app/pc', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetSetupPublishedForTests(); setSiteLocale('ru', { remember: false }) })

  it('the Windows download and what the PC app does — no menu, plans, prices, cabinet, donations or a link home', () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    render(<MemoryRouter><PcAppPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Raid OS на компьютере' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Скачать для Windows' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Скопировать ссылку/ })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Подписк|подписк|Тариф|тариф|Оплат|оплат|₽|\$|Кабинет|кабинет|Поддержать|пробн/)
    const links = [...document.querySelectorAll('a')].map((link) => link.getAttribute('href'))
    expect(links.every((href) => href !== null && /^\/download|\.exe$|^\/downloads\//.test(href))).toBe(true)
  })

  it('in English', () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    setSiteLocale('en', { remember: false })
    render(<MemoryRouter><PcAppPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Raid OS on your computer' })).toBeInTheDocument()
    expect(screen.getByText('Tasks are ticked by themselves from the game logs')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download for Windows' })).toBeInTheDocument()
  })
})
