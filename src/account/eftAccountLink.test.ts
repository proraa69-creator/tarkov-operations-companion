import { describe, expect, it } from 'vitest'
import { eftAccountIdOf, eftAccountIdsOf, reportEftAccounts } from './eftAccountLink'

describe('the game account of this PC from its logs', () => {
  // support chat, 20.11.2026: two players on one PC — the Season under the bound account, the other's PvP before it
  it('is the one that played last, whatever the mode', () => {
    expect(eftAccountIdOf({ latestMode: 'seasonal', latestAccountIdByMode: { pvp: 888, seasonal: 442 }, accountIds: [888, 442] })).toBe(442)
    expect(eftAccountIdOf({ latestMode: 'pvp', latestAccountIdByMode: { pvp: 888, seasonal: 442 }, accountIds: [888, 442] })).toBe(888)
  })

  it('without the newest mode: PvP, then PvE, then the Season', () => {
    expect(eftAccountIdOf({ latestAccountIdByMode: { pve: 2, seasonal: 3 }, accountIds: [2, 3] })).toBe(2)
    expect(eftAccountIdOf({ latestMode: 'pve', latestAccountIdByMode: { pvp: 1 }, accountIds: [1] })).toBe(1)
    expect(eftAccountIdOf({ latestAccountIdByMode: {}, accountIds: [] })).toBeUndefined()
  })
})

describe('the game accounts offered to the server', () => {
  it('every one of the logs, the one that played last first', () => {
    expect(eftAccountIdsOf({ latestMode: 'seasonal', latestAccountIdByMode: { pvp: 392, seasonal: 777 }, accountIds: [392, 777] })).toEqual([777, 392])
    expect(eftAccountIdsOf({ latestAccountIdByMode: {}, accountIds: [] })).toEqual([])
  })

  // support chat, 20.11.2026: «после обновления… к этому аккаунту Raid OS привязан другой аккаунт» — a second game account played last
  it('in turn until the server takes one: the bound account is found wherever it played', async () => {
    const sent: string[] = []
    const request = async (_method: 'POST', _path: string, body: unknown) => {
      const id = (body as { accountId: string }).accountId
      sent.push(id)
      if (id !== '392') throw new Error('К этому аккаунту Raid OS привязан другой аккаунт Escape from Tarkov.')
      return {}
    }
    expect(await reportEftAccounts(request, [777, 392])).toEqual({ taken: 392 })
    expect(sent).toEqual(['777', '392'])
  })

  it('none taken: the newest is reported again last, so the lock tells about it', async () => {
    const sent: string[] = []
    const request = async (_method: 'POST', _path: string, body: unknown) => {
      sent.push((body as { accountId: string }).accountId)
      throw new Error('Этот аккаунт Escape from Tarkov уже используется: он привязан к другому аккаунту Raid OS.')
    }
    expect(await reportEftAccounts(request, [777, 888])).toEqual({ refused: expect.stringMatching(/уже используется/) })
    expect(sent).toEqual(['777', '888', '777'])
  })

  it('a server not reached stops at once', async () => {
    const request = async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED') }
    expect(await reportEftAccounts(request, [777, 392])).toEqual({ failed: true })
  })
})
