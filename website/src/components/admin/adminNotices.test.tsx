import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** «Объявления» on the website: the owner app's tools on the same API, with the owner's session. */
vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: { email: 'owner@example.com', owner: true } }) }))
const { AdminNotices } = await import('./AdminNotices')

const notice = { id: 4, kind: 'announcement', title: 'Техработы', text: 'В 3:00', images: 0, audience: { regions: ['europe'], payment: 'all' }, createdAt: '2026-10-15T10:00:00.000Z', targeted: 3, seen: 2, closed: 1 }

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('admin «Объявления»', () => {
  it('lists the sent ones and sends a new one with the owner\'s session', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as unknown : undefined
      if (url.endsWith('/v1/accounts/me/admin/notices?kind=announcement')) return Response.json({ notices: [notice] })
      if (url.endsWith('/v1/accounts/me/admin/notices?kind=survey')) return Response.json({ notices: [] })
      if (url.endsWith('/v1/accounts/me/admin/notices') && init?.method === 'POST') return Response.json({ notice: { ...notice, id: 5, ...(body as object) } }, { status: 201 })
      return Response.json({ error: 'Не найдено' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<MemoryRouter><AdminNotices /></MemoryRouter>)
    const sent = await screen.findByRole('region', { name: 'Отправленные объявления' })
    expect(await within(sent).findByText('Техработы')).toBeInTheDocument()
    expect(within(sent).getByText(/Европа · Все/)).toBeInTheDocument()
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ authorization: 'Bearer owner-token' })
    await user.click(screen.getByRole('button', { name: 'Создать объявление' }))
    await user.type(screen.getByRole('textbox', { name: 'Заголовок' }), 'Скидка')
    await user.type(screen.getByRole('textbox', { name: /^Текст/ }), 'Только сегодня')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/v1\/accounts\/me\/admin\/notices$/), expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: 'Скидка', text: 'Только сегодня', audience: { regions: [], payment: 'all' }, images: [] }) })))
  })
})
