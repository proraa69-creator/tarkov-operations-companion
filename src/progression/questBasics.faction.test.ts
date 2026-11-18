import { describe, expect, it } from 'vitest'
import { ofFaction, playerFaction } from './questBasics'

// report №191: «Обновка. Часть 2» and «Текстиль» come once for each faction (Season, no profile)
const quests = [
  { id: 'drip2-bear', faction: 'BEAR' },
  { id: 'drip2-usec', faction: 'USEC' },
  { id: 'textile1-usec', faction: 'USEC' },
  { id: 'any', faction: 'Any' },
]

describe('player faction', () => {
  it('takes the profile faction first', () => {
    expect(playerFaction({ faction: 'bear', taskProgress: { 'textile1-usec': { status: 'completed' } } }, quests)).toBe('bear')
  })

  it('reads it from a one-faction quest the player took', () => {
    expect(playerFaction({ faction: 'unknown', taskProgress: { 'textile1-usec': { status: 'completed' } } }, quests)).toBe('usec')
    expect(playerFaction({ faction: 'unknown', taskProgress: { any: { status: 'active' } } }, quests)).toBe('unknown')
    // both factions taken: a wrong reading somewhere
    expect(playerFaction({ faction: 'unknown', taskProgress: { 'drip2-bear': { status: 'active' }, 'textile1-usec': { status: 'completed' } } }, quests)).toBe('unknown')
  })

  it('leaves the other faction out only when known', () => {
    expect(ofFaction(quests, 'usec').map((quest) => quest.id)).toEqual(['drip2-usec', 'textile1-usec', 'any'])
    expect(ofFaction(quests, 'unknown')).toHaveLength(4)
  })
})
