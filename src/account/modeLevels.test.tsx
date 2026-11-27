import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { knownModeLevels } from './modeLevels'

const status = { signedIn: true, online: true, email: 'player@example.com', kind: 'user' as const, subscription: { status: 'active' as const, paidUntil: '2027-11-12T00:00:00.000Z' }, emailVerified: true, serverUrl: 'https://raidos.app', persistent: true }
vi.mock('../sync/serverSync', async (original) => ({ ...await original<typeof import('../sync/serverSync')>(), useServerAccount: () => ({ status, logout: vi.fn() }) }))
vi.mock('./useAccountNickname', () => ({ useAccountNickname: () => 'Raid_OS' }))
const anchor = { source: 'screen', at: '2026-11-15T10:00:00.000Z' }
vi.mock('../state/AppState', async (original) => ({
  ...await original<typeof import('../state/AppState')>(),
  useOptionalAppState: () => ({ activeProfile: { modes: { pvp: { playerLevel: 41, levelAnchor: anchor }, pve: { playerLevel: 23, levelAnchor: anchor }, seasonal: { playerLevel: 1 } } } }),
}))

const { ClientCabinetPanel } = await import('./ClientCabinetPanel')

afterEach(cleanup)

/** Owner, 15.11.2026: «Ник в игре» inside the account cell, with each mode's level the app has read. */
describe('«Личный кабинет»: the nickname and the levels', () => {
  it('keeps only the modes with a level read from the game', () => {
    expect(knownModeLevels({ pvp: { playerLevel: 41, levelAnchor: anchor as never }, pve: { playerLevel: 5 }, seasonal: { playerLevel: 0, levelAnchor: anchor as never } })).toEqual([{ mode: 'pvp', level: 41 }])
  })

  // Owner, 27.11.2026: «нижняя граница уровня по квестам и ручной ввод уровня».
  it('lists the player\'s own entry of a mode as its level, never the estimate from its quests', () => {
    const typed = { level: 30, observedAt: '2026-11-27T10:00:00.000Z', source: 'manual' as const }
    expect(knownModeLevels({ pvp: { playerLevel: 24 }, pve: { playerLevel: 31, levelAnchor: typed }, seasonal: { playerLevel: 1 } })).toEqual([{ mode: 'pve', level: 31 }])
  })

  it('shows the nickname under the account, with the levels per mode', () => {
    render(<ClientCabinetPanel />)
    const identity = screen.getByText('player@example.com').closest('.account-cabinet-identity')!
    expect(identity).toHaveTextContent('Ник в игре')
    expect(identity).toHaveTextContent('Raid_OS')
    expect([...identity.querySelectorAll('.account-cabinet-levels em')].map((tag) => tag.textContent)).toEqual(['PVP · Уровень 41', 'PVE · Уровень 23'])
  })
})
