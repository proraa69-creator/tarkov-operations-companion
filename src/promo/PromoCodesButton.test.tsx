import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  // Owner, 06.11.2026: «когда человек нажимает скопировать кнопку, у него автоматически ставится галочка на этом промокоде, что он использован».
  it('«Скопировать» ticks the code as used, it stays ticked, and the tick can be taken off', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    const { unmount } = render(<LocaleProvider><PromoCodesButton /></LocaleProvider>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Промокоды: 1' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Промокоды: 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Промокоды' })
    const tick = () => within(dialog).getByRole('checkbox', { name: 'Использован: UNDEADTARKOV' })
    expect(tick()).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(within(dialog).getByRole('button', { name: /UNDEADTARKOV/ }))
    await waitFor(() => expect(tick()).toHaveAttribute('aria-checked', 'true'))
    expect(writeText).toHaveBeenCalledWith('UNDEADTARKOV')
    expect(within(dialog).getByRole('checkbox', { name: 'Использован: WIPE' })).toHaveAttribute('aria-checked', 'false')
    unmount()
    render(<LocaleProvider><PromoCodesButton /></LocaleProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Промокоды' }))
    const again = screen.getByRole('checkbox', { name: 'Использован: UNDEADTARKOV' })
    expect(again).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(again)
    expect(screen.getByRole('checkbox', { name: 'Использован: UNDEADTARKOV' })).toHaveAttribute('aria-checked', 'false')
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
    // Owner, 07.11.2026: the word on the new one only, gone the next time the window opens.
    expect(within(dialog.querySelector('.promo-row.is-new') as HTMLElement).getByText('Новый')).toBeInTheDocument()
    expect(within(dialog).getAllByText('Новый')).toHaveLength(1)
    expect(within(dialog).queryByRole('button', { name: /Прочитан/ })).toBeNull()
    await waitFor(() => expect(container.querySelector('.nav-badge')).toBeNull())
    expect(within(dialog).getByText('Новый')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }))
    fireEvent.click(screen.getByRole('button', { name: 'Промокоды' }))
    expect(within(screen.getByRole('dialog', { name: 'Промокоды' })).queryByText('Новый')).toBeNull()
    unmount()
  })
})
