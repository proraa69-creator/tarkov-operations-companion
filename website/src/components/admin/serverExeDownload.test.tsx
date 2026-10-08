import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ServerExeSection } from './AdminUpdate'

vi.mock('../../config', () => ({ API_URL: '/api' }))

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('starts an authenticated server download under the API prefix with one click', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    url: '/v1/server-exe/test-ticket', size: 123, expiresAt: '2026-10-08T00:00:00Z',
  }), { headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', request)
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.pathname).toBe('/api/v1/server-exe/test-ticket')
    expect(this.download).toBe('Raid OS Server.exe')
  })
  render(<ServerExeSection token="test-owner-token" />)
  fireEvent.click(screen.getByRole('button', { name: 'Скачать серверную версию' }))
  await waitFor(() => expect(click).toHaveBeenCalledOnce())
  expect(request).toHaveBeenCalledWith('/api/v1/accounts/me/admin/server-exe-link', expect.objectContaining({
    method: 'POST', headers: { authorization: 'Bearer test-owner-token' },
  }))
})

it('shows access errors without starting a download', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Не найдено' }), { status: 404 })))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<ServerExeSection token="test-player-token" />)
  fireEvent.click(screen.getByRole('button', { name: 'Скачать серверную версию' }))
  expect(await screen.findByText('Не найдено')).toBeInTheDocument()
  expect(click).not.toHaveBeenCalled()
})
