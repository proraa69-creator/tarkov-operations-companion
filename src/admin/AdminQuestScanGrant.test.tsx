import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AdminQuestScanGrant, TRIAL_FEATURES_PATH } from './AdminQuestScanGrant'

describe('«Поиск квестов по экрану для игрока» (owner, 01.11.2026)', () => {
  it('turns it on for a day by e-mail, lists the players it is on for and turns it off', async () => {
    let grants: Array<{ email: string; until: string; grantedBy: string }> = []
    const request = vi.fn(async (method: string, _path: string, body?: unknown) => {
      if (method === 'GET') return { grants }
      const { email, hours } = body as { email: string; hours: number }
      const grant = { email: email.toLowerCase(), until: '2026-11-02T12:00:00.000Z', grantedBy: 'owner@example.com' }
      grants = hours ? [grant] : []
      return { grant }
    })
    render(<AdminQuestScanGrant request={request} />)
    fireEvent.change(screen.getByLabelText('E-mail игрока'), { target: { value: 'Player@Example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Включить на сутки' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Включено для player@example.com'))
    expect(request).toHaveBeenCalledWith('PUT', TRIAL_FEATURES_PATH, { email: 'Player@Example.com', feature: 'questTableScan', hours: 24 })
    expect(screen.getByText('player@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Выключить' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Выключено для player@example.com'))
    expect(request).toHaveBeenLastCalledWith('GET', TRIAL_FEATURES_PATH)
    expect(screen.queryByRole('button', { name: 'Выключить' })).toBeNull()
  })

  it('shows the server\'s answer when no account has the e-mail', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'GET') return { grants: [] }
      throw new Error('Аккаунт с таким e-mail не найден')
    })
    render(<AdminQuestScanGrant request={request} />)
    fireEvent.change(screen.getByLabelText('E-mail игрока'), { target: { value: 'nobody@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Включить на сутки' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Аккаунт с таким e-mail не найден'))
  })
})
