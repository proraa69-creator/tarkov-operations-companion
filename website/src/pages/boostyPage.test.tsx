import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { BoostyPage } from './BoostyPage'

const offers = [
  { key: 'WORLD_STANDARD', region: 'WORLD' as const, kind: 'standard' as const, url: 'https://boosty.to/raidosapp/purchase/4136082?ssource=DIRECT&share=subscription_link' },
  { key: 'WORLD_FRIEND', region: 'WORLD' as const, kind: 'friend' as const, url: 'https://boosty.to/raidosapp/purchase/4136112?ssource=DIRECT&share=subscription_link' },
  { key: 'CIS_STANDARD', region: 'CIS' as const, kind: 'standard' as const, url: 'https://boosty.to/raidosapp/purchase/4136107?ssource=DIRECT&share=subscription_link' },
  { key: 'CIS_FRIEND', region: 'CIS' as const, kind: 'friend' as const, url: 'https://boosty.to/raidosapp/purchase/4136111?ssource=DIRECT&share=subscription_link' },
]

afterEach(() => vi.restoreAllMocks())

describe('raidos.app/boosty', () => {
  it('opens without an account and has a button for every Boosty subscription after the e-mail warning', async () => {
    vi.spyOn(api, 'boostyPublic').mockResolvedValue({ offers, regionHint: 'CIS' })
    render(<MemoryRouter><BoostyPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'СНГ (кроме России)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Другие страны' })).toBeInTheDocument()
    // before the warning is acknowledged no button leads anywhere
    expect(screen.queryAllByRole('link', { name: /Подписка/ })).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: /Подписка/ }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    fireEvent.click(screen.getByLabelText('Понятно: укажу на Boosty email своего аккаунта Raid OS'))
    const links = screen.getAllByRole('link', { name: /Подписка/ })
    expect(links.map((link) => link.getAttribute('href')).sort()).toEqual(offers.map((offer) => offer.url).sort())
    expect(screen.getAllByRole('link', { name: 'Подписка со скидкой друга' })).toHaveLength(2)
  })
})
