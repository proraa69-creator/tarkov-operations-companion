// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

/**
 * «Сводка» of the PC owner app (owner, 15.11.2026: «точная копия сайта»): the site's owner requests of «Сводка»,
 * «Платежи», «Пользователи», «Привлечение друзей» and «Стримеры» pass the gateway in the owner's build only; no CSV, no
 * other admin routes, no dotted path parts, no DELETE.
 */
vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => false, buildDefaultServerUrl: () => '', buildEntitlementKeys: () => [] }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { ownerSiteAdminAllowed, serviceRequest } = await import('./serviceGateway')
const admin = '/v1/accounts/me/admin'

describe('owner site admin routes through the gateway', () => {
  it('lets the tabs\' requests through in the owner build', () => {
    for (const [method, path] of [
      ['GET', `${admin}/overview`], ['GET', `${admin}/stats?from=2026-11-01&to=2026-11-05`], ['GET', `${admin}/calendar?month=2026-11`], ['GET', `${admin}/day?date=2026-11-05`],
      ['GET', `${admin}/series?period=month`], ['GET', `${admin}/payments?q=payer%40example.com&status=succeeded&limit=50&offset=0`],
      ['GET', `${admin}/users?q=payer%40example.com&filter=all&limit=50&offset=0`], ['GET', `${admin}/users/${'a'.repeat(24)}`],
      ['POST', `${admin}/users/${'a'.repeat(24)}/grant`], ['POST', `${admin}/users/${'a'.repeat(24)}/devices/Ab-_09xyz/revoke`],
      ['GET', `${admin}/referrals?q=x.y%40example.com&sort=invited`], ['PUT', `${admin}/streamers/HUNTER/percent`], ['GET', `${admin}/streamer-stats?code=HUNTER&period=day`],
      ['GET', `${admin}/bezebee/events?limit=30`], ['POST', `${admin}/payments/${'b'.repeat(24)}/refunded`], ['GET', `${admin}/payouts`], ['PUT', `${admin}/payout-limits`],
    ] as const) expect(ownerSiteAdminAllowed(method, path, true), `${method} ${path}`).toBe(true)
  })

  it('refuses players\' builds, CSV files, other routes, dots and DELETE', () => {
    expect(ownerSiteAdminAllowed('GET', `${admin}/overview`, false)).toBe(false)
    for (const [method, path] of [
      ['GET', `${admin}/payments.csv`], ['GET', `${admin}/users.csv?filter=all`], ['GET', `${admin}/audit`], ['GET', `${admin}/ads?period=day`],
      ['GET', `${admin}/users/../../../v1/catalog/pvp`], ['GET', `${admin}/users/%2e%2e/x`], ['DELETE', `${admin}/users/${'a'.repeat(24)}`],
      ['GET', `${admin}/overviewx`], ['GET', `/v1/accounts/me/admin2/overview`], ['GET', `${admin}/overview#x`],
    ] as const) expect(ownerSiteAdminAllowed(method, path, true), `${method} ${path}`).toBe(false)
  })

  it('a players\' build refuses the request before sending it', async () => {
    await expect(serviceRequest('GET', `${admin}/overview`)).rejects.toThrow('Неизвестный запрос сервиса')
  })
})
