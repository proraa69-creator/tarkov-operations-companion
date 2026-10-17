import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api'
import { AdminBoostySession, BOOSTY_BOOKMARKLET } from './AdminBoostySession'

afterEach(() => vi.restoreAllMocks())

describe('«Токен Boosty» in the owner panel', () => {
  it('sends the pasted session once, clears the field and reloads the panel', async () => {
    const save = vi.spyOn(api, 'adminBoostySession').mockResolvedValue({ sync: { configured: true, paused: false, running: false, tokenDead: false } })
    const reload = vi.fn()
    render(<AdminBoostySession token="t" dead onSaved={reload} />)
    const field = screen.getByLabelText('Данные Boosty (то, что показала закладка)')
    fireEvent.change(field, { target: { value: '{"auth":"a","clientId":"b"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и проверить' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('t', '{"auth":"a","clientId":"b"}'))
    expect(await screen.findByText('Токен сохранён')).toBeInTheDocument()
    expect((field as HTMLTextAreaElement).value).toBe('')
    expect(reload).toHaveBeenCalled()
  })

  it('the bookmark only reads the page\'s storage and sends nothing', () => {
    expect(BOOSTY_BOOKMARKLET.startsWith('javascript:')).toBe(true)
    expect(BOOSTY_BOOKMARKLET).toContain("localStorage.getItem('auth')")
    expect(BOOSTY_BOOKMARKLET).toContain("localStorage.getItem('_clientId')")
    expect(BOOSTY_BOOKMARKLET).not.toMatch(/fetch|XMLHttpRequest|sendBeacon|https?:|location\s*=/)
  })
})
