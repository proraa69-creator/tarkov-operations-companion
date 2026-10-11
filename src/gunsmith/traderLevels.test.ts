import { describe, expect, it } from 'vitest'
import { cheapestOffer, offerAccess } from '../arsenal/buildStats'
import type { Quest, TaskProgressStatus, Trader } from '../domain/types'
import { estimateTraderLevel, loyaltyNumeral, playerAccess, traderLevelInfos } from './traderLevels'

const trader = (id: string, normalizedName: string, levelPlayerLevels = [1, 15, 26, 36]): Trader => ({ id, name: normalizedName, normalizedName, role: '', loyalty: 4, accent: '', levelPlayerLevels })
const quest = (id: string, loyalty: Quest['traderLoyalty']): Quest => ({ id, name: id, trader: '', level: 1, kappa: false, description: '', objectives: [], rewards: [], traderLoyalty: loyalty })

describe('trader loyalty estimate (EFT logs carry no loyalty)', () => {
  const prapor = trader('t-prapor', 'prapor')
  const quests = [
    quest('needs-2', { needed: [{ traderId: 't-prapor', level: 2 }], reached: [] }),
    quest('reach-3', { needed: [], reached: [{ traderId: 't-prapor', level: 3 }] }),
  ]

  it('takes the level the tasks prove, capped by the character level', () => {
    const status = (map: Record<string, TaskProgressStatus>) => (id: string) => map[id]
    expect(estimateTraderLevel(prapor, quests, status({}), 40)).toEqual({ min: 1, max: 4 })
    // Taking a task that needs loyalty 2 proves 2; reaching loyalty 3 counts only when the task is done.
    expect(estimateTraderLevel(prapor, quests, status({ 'needs-2': 'active', 'reach-3': 'active' }), 40).min).toBe(2)
    expect(estimateTraderLevel(prapor, quests, status({ 'needs-2': 'completed', 'reach-3': 'completed' }), 40).min).toBe(3)
    // Character level 20: loyalty 3 needs level 26.
    expect(estimateTraderLevel(prapor, quests, status({}), 20)).toEqual({ min: 1, max: 2 })
  })

  it('keeps the player’s own choice over the estimate, per trader key', () => {
    const infos = traderLevelInfos([prapor, trader('t-mech', 'mechanic')], quests, () => 'completed', 40, { mechanic: 4 })
    expect(infos.map((info) => [info.key, info.level, info.manual])).toEqual([['prapor', 3, undefined], ['mechanic', 4, 4]])
  })

  it('decides per trader whether a part can be bought, and the flea from level 15', () => {
    const infos = traderLevelInfos([prapor, trader('t-mech', 'mechanic')], [], () => undefined, 12, { mechanic: 2 })
    const access = playerAccess(infos, 12, true, (id) => id === 'done-task')
    expect(access.flea).toBe(false)
    const part = { noFlea: false, offers: [
      { vendor: 'flea-market', vendorName: 'Барахолка', priceRUB: 9000 },
      { vendor: 'prapor', vendorName: 'Прапор', priceRUB: 5000, minTraderLevel: 2 },
      { vendor: 'mechanic', vendorName: 'Механик', priceRUB: 7000, minTraderLevel: 2 },
      { vendor: 'mechanic', vendorName: 'Механик', priceRUB: 6000, minTraderLevel: 1, taskUnlock: { id: 'other-task', name: 'Другое' } },
    ] }
    expect(offerAccess(part.offers[1], part, access)).toEqual({ ok: false, reason: 'level', level: 1 })
    expect(offerAccess(part.offers[0], part, access)).toEqual({ ok: false, reason: 'flea-closed' })
    expect(offerAccess(part.offers[3], part, access)).toEqual({ ok: false, reason: 'task' })
    expect(cheapestOffer(part, access)?.priceRUB).toBe(7000)
  })

  it('writes loyalty like the game: I, II, III, then a crown', () => {
    expect([1, 2, 3, 4].map(loyaltyNumeral)).toEqual(['I', 'II', 'III', ''])
  })
})
