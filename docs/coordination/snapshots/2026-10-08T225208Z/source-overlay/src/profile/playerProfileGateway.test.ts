import { afterEach, expect, it, vi } from 'vitest'
import { desktopPlayerProfileGateway } from './playerProfileGateway'

vi.mock('../sync/serverSync', () => ({ usesWebAccount: () => false }))
vi.mock('../sync/webAccount', () => ({ webServiceRequest: vi.fn() }))

afterEach(() => vi.unstubAllGlobals())

it('rejects an empty desktop refresh before updating application state', async () => {
  vi.stubGlobal('window', { tarkovDesktop: { refreshPlayerProfile: vi.fn().mockResolvedValue(null) } })
  await expect(desktopPlayerProfileGateway().fetchByAccountId('pvp', 1)).rejects.toThrow('Сервер не вернул профиль')
})

it('rejects a nickname binding without a character snapshot', async () => {
  vi.stubGlobal('window', { tarkovDesktop: { resolvePlayerProfile: vi.fn().mockResolvedValue({ accountId: 1, snapshot: null }) } })
  await expect(desktopPlayerProfileGateway().resolveByNickname('pvp', 'Operator')).rejects.toThrow('Сервер не вернул профиль')
})
