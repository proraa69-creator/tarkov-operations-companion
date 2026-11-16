import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { questOfferUnlocks, withOfferUnlocks } from './questOfferUnlocks'

const prapor = '54cb50c76803fa8b248b4571'
const mechanic = '5a7c2eca46aef81a7ca2145d'

describe('what each quest opens at the traders', () => {
  const tasks = { tasks: {
    q1: { id: 'q1', finishRewards: { offerUnlock: [{ id: 'u1', trader: prapor, level: 2, item: 'ammo-bt' }, { id: 'u2', trader: mechanic, level: 3, item: 'case' }] } },
    q2: { id: 'q2', finishRewards: { offerUnlock: [] } },
  } }
  const items = { items: {
    'ammo-bt': { id: 'ammo-bt', buyFromTrader: [{ trader: prapor, minTraderLevel: 2, taskUnlock: 'q1' }, { trader: mechanic, minTraderLevel: 1 }] },
    muzzle: { id: 'muzzle', buyFromTrader: [{ trader: mechanic, minTraderLevel: 2, taskUnlock: { id: 'q2', name: 'Q2' } }] },
  } }
  const barters = { barters: [
    { trader: mechanic, minTraderLevel: 3, taskUnlock: 'q1', offeredItem: { item: 'case' } },
    { trader: prapor, minTraderLevel: 4, taskUnlock: 'q2', offeredItem: { item: 'muzzle' } },
    { trader: prapor, minTraderLevel: 1, offeredItem: { item: 'free' } },
  ] }

  it('joins the quest rewards, the offers for money and the barters that wait for a quest', () => {
    const unlocks = questOfferUnlocks(tasks, items, barters)
    expect(unlocks.get('q1')).toEqual([
      { itemId: 'ammo-bt', traderId: prapor, level: 2 },
      { itemId: 'case', traderId: mechanic, level: 3, barter: true },
    ])
    // An offer the quest's own rewards do not list still counts; a barter at another trader stays apart.
    expect(unlocks.get('q2')).toEqual([
      { itemId: 'muzzle', traderId: mechanic, level: 2 },
      { itemId: 'muzzle', traderId: prapor, level: 4, barter: true },
    ])
    expect([...unlocks.keys()].sort()).toEqual(['q1', 'q2'])
  })

  it('keeps the rows without the barters file and gives the field only to quests that open something', () => {
    const unlocks = questOfferUnlocks(tasks, items)
    expect(unlocks.get('q1')?.map((row) => row.itemId)).toEqual(['ammo-bt', 'case'])
    const quests = [{ id: 'q1' }, { id: 'q3' }] as Quest[]
    const rows = withOfferUnlocks(quests, unlocks)
    expect(rows[0].offerUnlocks).toHaveLength(2)
    expect(rows[1]).toBe(quests[1])
  })
})
