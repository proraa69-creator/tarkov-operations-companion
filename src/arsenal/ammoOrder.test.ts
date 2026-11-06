import { describe, expect, it } from 'vitest'
import { fleshDamage, sortAmmo } from './ammoOrder'

const rounds = [
  { id: 'piercing', damage: 40, penetration: 60 },
  { id: 'meaty', damage: 120, penetration: 8 },
  { id: 'even', damage: 70, penetration: 45 },
  { id: 'buckshot', damage: 50, penetration: 5, projectileCount: 8 },
]
const ids = (order: 'penetration' | 'damage' | 'balance') => sortAmmo(rounds, order).map((round) => round.id)

describe('the order of rounds in «Баллистика»', () => {
  it('by penetration first', () => {
    expect(ids('penetration')[0]).toBe('piercing')
  })

  it('by damage first, all pellets of a shell counted', () => {
    expect(fleshDamage(rounds[3]!)).toBe(400)
    expect(ids('damage').slice(0, 2)).toEqual(['buckshot', 'meaty'])
  })

  it('in balance a round good at both beats one that is good at one', () => {
    expect(ids('balance')[0]).toBe('even')
    expect(ids('balance').at(-1)).toBe('buckshot')
  })

  it('the list it was given stays as it was', () => {
    const before = rounds.map((round) => round.id)
    sortAmmo(rounds, 'damage')
    expect(rounds.map((round) => round.id)).toEqual(before)
  })
})
