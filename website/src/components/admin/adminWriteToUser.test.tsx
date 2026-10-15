import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** «Написать» on the website: the owner's support chat with one account, on the same API as the owner app. */
vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: { email: 'owner@example.com', owner: true } }) }))
const { WriteToUser } = await import('./WriteToUser')
const ID = 'b'.repeat(24)

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('admin «Написать»', () => {
  it('opens the conversation (empty: the owner writes first) and sends a message', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith(`/v1/accounts/me/admin/support/threads/${ID}`)) return Response.json({ account: { id: ID, email: 'p@example.com' }, messages: [] })
      if (url.endsWith(`/v1/accounts/me/admin/support/threads/${ID}/messages`) && init?.method === 'POST') return Response.json({ message: { id: 1, author: 'owner', text: 'Здравствуйте!', createdAt: '2026-10-15T10:00:00.000Z', read: false } }, { status: 201 })
      return Response.json({ error: 'Не найдено' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<WriteToUser accountId={ID} email="p@example.com" />)
    await user.click(screen.getByRole('button', { name: 'Написать' }))
    expect(screen.getByRole('dialog', { name: 'p@example.com' })).toBeInTheDocument()
    expect(await screen.findByText('Сообщений пока нет — вы напишете первым.')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'Здравствуйте!')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/messages$/), expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'Здравствуйте!' }), headers: expect.objectContaining({ authorization: 'Bearer owner-token' }) })))
    expect(await screen.findByText('Здравствуйте!')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Сообщение' })).toHaveValue('')
  })
})
