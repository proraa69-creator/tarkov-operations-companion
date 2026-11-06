import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { PromoCodesButton } from './PromoCodesButton'

const answer = {
  codes: [
    { code: 'UNDEADTARKOV', mode: 'pve', addedAt: '2026-11-06T12:00:00.000Z' },
    { code: 'WIPE', mode: 'season', addedAt: '2026-11-06T10:00:00.000Z', first: true },
  ],
}

describe('«Промокоды» in the Overview', () => {
  beforeEach(() => {
    localStorage.clear()
    ;(window as unknown as { tarkovDesktop: unknown }).tarkovDesktop = { serviceRequest: async () => answer }
  })

  it('counts what is new, shows each code with its date, and opening the window reads them with no button', async () => {
    const { container, unmount } = render(<LocaleProvider><PromoCodesButton /></LocaleProvider>)
    await waitFor(() => expect(container.querySelector('.nav-badge')).toHaveTextContent('1'))
    fireEvent.click(screen.getByRole('button', { name: 'Промокоды: 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Промокоды' })
    expect(within(dialog).getByText('UNDEADTARKOV')).toBeInTheDocument()
    expect(within(dialog).getByText('WIPE')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Добавлен 6 ноября')
    expect(within(dialog).getByText('Сезон')).toBeInTheDocument()
    expect(dialog.querySelectorAll('.promo-row.is-new')).toHaveLength(1)
    expect(within(dialog).queryByRole('button', { name: /Прочитан/ })).toBeNull()
    await waitFor(() => expect(container.querySelector('.nav-badge')).toBeNull())
    unmount()
  })
})
