import { describe, expect, it } from 'vitest'
import type { GameMap, Quest } from '../domain/types'
import { calculateMapAccess } from './mapAccess'

const map = { id: 'icebreaker' } as GameMap
const quest = { id: 'unlock', normalizedName: 'stick-to-it', name: 'Держись', trader: '', level: 1, kappa: false, description: '', objectives: [], rewards: [] } as Quest

describe('verified map access rules', () => {
  it('locks Icebreaker until Stick to It is completed', () => {
    expect(calculateMapAccess(map, [quest], new Map([['unlock', { status: 'available', blockers: [] }]]))).toMatchObject({ locked: true, quest })
    expect(calculateMapAccess(map, [quest], new Map([['unlock', { status: 'completed', blockers: [] }]]))).toMatchObject({ locked: false })
  })
})
