import { describe, expect, it } from 'vitest'
import { traderOfferOpen } from './moduleAccess'

const MECHANIC = '5a7c2eca46aef81a7ca2145d'
// the estimate allows Mechanic 1–2 at this character's level; the app holds 1 (nothing says more)
const levels = [{ trader: { id: MECHANIC }, level: 1, min: 1, max: 2 }]
const none = () => undefined

describe('«Продажа модулей»: only what the player can buy (owner, 19.11.2026, Season, Mechanic 1)', () => {
  it('an offer of Mechanic 2 is not shown to a Mechanic 1, whatever the estimate allows', () => {
    expect(traderOfferOpen({ traderId: MECHANIC, level: 2 }, levels, none)).toBe(false)
    expect(traderOfferOpen({ traderId: MECHANIC, level: 1 }, levels, none)).toBe(true)
  })

  it('a level the player set or the traders\' screen read opens it', () => {
    expect(traderOfferOpen({ traderId: MECHANIC, level: 2 }, [{ trader: { id: MECHANIC }, level: 2 }], none)).toBe(true)
  })

  it('an offer behind a quest waits for the quest', () => {
    expect(traderOfferOpen({ traderId: MECHANIC, level: 1, questId: 'q' }, levels, none)).toBe(false)
    expect(traderOfferOpen({ traderId: MECHANIC, level: 1, questId: 'q' }, levels, () => 'completed')).toBe(true)
  })
})
