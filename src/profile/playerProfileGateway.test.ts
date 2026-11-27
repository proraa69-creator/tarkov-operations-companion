import { afterEach, expect, it, vi } from 'vitest'
import { desktopPlayerProfileGateway } from './playerProfileGateway'

vi.mock('../sync/serverSync', () => ({ usesWebAccount: () => false }))
vi.mock('../sync/webAccount', () => ({ webServiceRequest: vi.fn() }))

afterEach(() => vi.unstubAllGlobals())

it('rejects an empty desktop refresh before updating application state', async () => {
  vi.stubGlobal('window', { tarkovDesktop: { refreshPlayerProfile: vi.fn().mockResolvedValue(null) } })
  await expect(desktopPlayerProfileGateway().fetchByAccountId('pvp', 1)).rejects.toThrow('Сервер не вернул профиль')
})

// Security review, 27.11.2026: the desktop channel that found a profile by nickname had no handler since 14.10.2026.
it('offers no lookup by nickname: its channel is gone', () => {
  vi.stubGlobal('window', { tarkovDesktop: { refreshPlayerProfile: vi.fn() } })
  expect(Object.keys(desktopPlayerProfileGateway())).toEqual(['fetchByAccountId'])
})
