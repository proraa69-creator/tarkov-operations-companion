import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Cabinet: «Выйти на всех устройствах» (POST /v1/accounts/me/sessions/revoke-all). */
const mocks = vi.hoisted(() => ({ revokeAllSessions: vi.fn(), logout: vi.fn() }))

vi.mock('../auth', () => ({ useAuth: () => ({ token: 'session-token', logout: mocks.logout }) }))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  return { ...actual, api: { ...actual.api, revokeAllSessions: mocks.revokeAllSessions } }
})

const { SignOutEverywherePanel } = await import('./SignOutEverywherePanel')

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/cabinet']}>
      <Routes>
        <Route path="/cabinet" element={<SignOutEverywherePanel />} />
        <Route path="/" element={<p>home</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SignOutEverywherePanel', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('asks first, then ends every session and signs this browser out', async () => {
    mocks.revokeAllSessions.mockResolvedValue({ revoked: 3 })
    mocks.logout.mockResolvedValue(undefined)
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Выйти на всех устройствах/ }))
    expect(mocks.revokeAllSessions).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Да, выйти везде/ }))
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument())
    expect(mocks.revokeAllSessions).toHaveBeenCalledWith('session-token')
    expect(mocks.logout).toHaveBeenCalledTimes(1)
  })

  it('shows the server error and stays signed in', async () => {
    const { ApiError } = await import('../api')
    mocks.revokeAllSessions.mockRejectedValue(new ApiError(503, 'Сервер недоступен'))
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Выйти на всех устройствах/ }))
    fireEvent.click(screen.getByRole('button', { name: /Да, выйти везде/ }))
    expect(await screen.findByText('Сервер недоступен')).toBeInTheDocument()
    expect(mocks.logout).not.toHaveBeenCalled()
  })
})
