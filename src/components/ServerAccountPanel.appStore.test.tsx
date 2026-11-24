import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The iPhone app (App Store build): no «Личный кабинет» and no website sign-in by QR (owner, 12.11.2026).
vi.mock('../platform', async (original) => ({ ...(await original<typeof import('../platform')>()), appStoreRules: () => true }))

import { ServerAccountPanel } from './ServerAccountPanel'

describe('ServerAccountPanel in the iPhone app', () => {
  afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop') })

  it('has «Выйти» but neither «Личный кабинет» nor «Подтвердить вход на сайте»', async () => {
    const account = { status: vi.fn().mockResolvedValue({ signedIn: true, email: 'a@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true }), login: vi.fn(), logout: vi.fn(), openWebsite: vi.fn() }
    Object.assign(window, { tarkovDesktop: { serviceRequest: vi.fn().mockResolvedValue(null), account } })
    render(<ServerAccountPanel />)
    expect(await screen.findByRole('button', { name: 'Выйти' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Личный кабинет' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Подтвердить вход на сайте' })).toBeNull()
  })
})
