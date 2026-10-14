import { describe, expect, it } from 'vitest'
import { cheapestOffer, offerAccess } from '../arsenal/buildStats'
import type { Quest, TaskProgressStatus, Trader } from '../domain/types'
import { estimateTraderLevel, loyaltyNumeral, playerAccess, readManualTraderLevels, readScreenTraderLevels, saveScreenTraderLevels, traderLevelInfos } from './traderLevels'

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

  it('takes the traders\' screen as proof of at least its level, not as an override (audit P18)', () => {
    // Read 3 on the screen: the estimate alone said 1.
    expect(traderLevelInfos([prapor], quests, () => undefined, 40, {}, { prapor: 3 }).map((info) => [info.level, info.min, info.screen])).toEqual([[3, 3, 3]])
    // The tasks prove 3 since a reading of 2: the higher wins.
    expect(traderLevelInfos([prapor], quests, () => 'completed', 40, {}, { prapor: 2 })[0]!.level).toBe(3)
    // The character's level bound (20 → 2) never hides what the game showed.
    expect(traderLevelInfos([prapor], quests, () => undefined, 20, {}, { prapor: 4 }).map((info) => [info.level, info.max])).toEqual([[4, 4]])
    // A player's own choice still wins.
    expect(traderLevelInfos([prapor], quests, () => undefined, 40, { prapor: 1 }, { prapor: 3 })[0]!.level).toBe(1)
  })

  it('keeps a reading per mode and per character, with its time; a new character starts without it', () => {
    localStorage.clear()
    saveScreenTraderLevels('pve', 'old-wipe', { prapor: 4, skier: 3 }, '2026-10-01T10:00:00.000Z')
    saveScreenTraderLevels('pve', 'old-wipe', { prapor: 3 }, '2026-10-02T10:00:00.000Z')
    expect(readScreenTraderLevels('pve', 'old-wipe')).toEqual({ at: '2026-10-02T10:00:00.000Z', levels: { prapor: 3, skier: 3 } })
    expect(readScreenTraderLevels('pve', 'new-wipe')).toBeUndefined()
    expect(readScreenTraderLevels('pvp', 'old-wipe')).toBeUndefined()
    // Unknown character (no profile line in the logs): its own entry, used only while it stays unknown.
    saveScreenTraderLevels('seasonal', undefined, { ref: 2 }, '2026-10-02T10:00:00.000Z')
    expect(readScreenTraderLevels('seasonal', undefined)?.levels).toEqual({ ref: 2 })
    expect(readScreenTraderLevels('seasonal', 'known-now')).toBeUndefined()
    // An older reading than the stored one changes nothing it already has; it may fill in a trader it lacks.
    saveScreenTraderLevels('pve', 'old-wipe', { prapor: 4, ref: 2 }, '2026-09-30T10:00:00.000Z')
    expect(readScreenTraderLevels('pve', 'old-wipe')).toEqual({ at: '2026-10-02T10:00:00.000Z', levels: { prapor: 3, skier: 3, ref: 2 } })
  })

  it('no longer reads the old store, which held the traders\' screen as a permanent override of every character', () => {
    localStorage.clear()
    localStorage.setItem('raid-os-trader-levels-v1', JSON.stringify({ pve: { prapor: 4 } }))
    expect(readManualTraderLevels('pve')).toEqual({})
  })

  it('writes loyalty like the game: I, II, III, then a crown', () => {
    expect([1, 2, 3, 4].map(loyaltyNumeral)).toEqual(['I', 'II', 'III', ''])
  })
})
