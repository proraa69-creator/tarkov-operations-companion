import { describe, expect, it } from 'vitest'
import { spotIsNeeded } from './neededSpawns'

const needed = new Set(['gpu', 'bolts'])
const neededKeys = new Set(['dorm-114'])

describe('«Показывать только нужные спавны» (owner, 19.11.2026)', () => {
  it('a loot spot stays when one of its items is still needed, and goes otherwise', () => {
    expect(spotIsNeeded({ layerId: 'loot.technical', lootIds: ['wires', 'gpu'] }, needed, neededKeys)).toBe(true)
    expect(spotIsNeeded({ layerId: 'loot.technical', lootIds: ['wires', 'tape'] }, needed, neededKeys)).toBe(false)
  })

  it('a key spot stays when it holds a key the quests need', () => {
    expect(spotIsNeeded({ layerId: 'loot.key', keyIds: ['dorm-114', 'other'] }, needed, neededKeys)).toBe(true)
    expect(spotIsNeeded({ layerId: 'loot.key', keyIds: ['other'] }, needed, neededKeys)).toBe(false)
  })

  it('a spot of unknown contents (a container) stays: nothing says what lies in it', () => {
    expect(spotIsNeeded({ layerId: 'loot.container' }, needed, neededKeys)).toBe(true)
  })
})
