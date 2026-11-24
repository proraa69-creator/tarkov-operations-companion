import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { questItemNeeds } from '../squad/squadOverview'
import { keyUsed, openRequiredItems, usedQuestKeys } from './objectives'

const tick = { current: 1, target: 1 }
const marks = (...ids: string[]) => ({ taskProgress: {}, objectiveProgress: Object.fromEntries(ids.map((id) => [id, tick])) as never })
const key = (itemId: string, extra: object = {}) => ({ itemId, count: 1, purpose: 'key' as const, mapIds: [], ...extra })
const quest = (raidRequirements: NonNullable<Quest['raidRequirements']>, requiredItems: string[] = []) => ({ id: 'q', raidRequirements, requiredItems })

// Owner, 06.11.2026: «После того как ты отметил в приложении что ты посетил место рентгенолога он до сих пор требует ключ от этой комнаты».
describe('a key and the objectives it opens', () => {
  it('is used when its objective is ticked, and only then', () => {
    expect(keyUsed(marks(), 'q', { objectiveId: 'room' })).toBe(false)
    expect(keyUsed(marks('hall'), 'q', { objectiveId: 'room' })).toBe(false)
    expect(keyUsed(marks('room'), 'q', { objectiveId: 'room' })).toBe(true)
  })

  it('a key of several objectives is used when all are ticked', () => {
    const both = { objectiveId: 'room', objectiveIds: ['room', 'hall'] }
    expect(keyUsed(marks('room'), 'q', both)).toBe(false)
    expect(keyUsed(marks('room', 'hall'), 'q', both)).toBe(true)
  })

  it('a key that names no objective is never used up (a catalog of a server not updated yet)', () => {
    expect(keyUsed(marks('room'), 'q', {})).toBe(false)
  })

  it('a key replaced by another: both go with the objective', () => {
    const rows = [key('a', { objectiveId: 'room', alternatives: 2 }), key('b', { objectiveId: 'room', alternatives: 2 })]
    expect([...usedQuestKeys(quest(rows), marks('room'))]).toEqual(['a', 'b'])
    expect([...usedQuestKeys(quest(rows), marks())]).toEqual([])
  })

  it('an item the quest also takes for anything else is not a used key', () => {
    const rows = [key('a', { objectiveId: 'room' }), { itemId: 'a', count: 1, purpose: 'handover' as const, mapIds: [], objectiveId: 'give' }]
    expect(usedQuestKeys(quest(rows), marks('room')).size).toBe(0)
  })

  it('the plain list of items loses only the used key', () => {
    expect(openRequiredItems(quest([key('a', { objectiveId: 'room' })], ['a', 'meds']), marks('room'))).toEqual(['meds'])
    expect(openRequiredItems(quest([key('a', { objectiveId: 'room' })], ['a', 'meds']), marks())).toEqual(['a', 'meds'])
  })

  it('a squad mate: gone with the objective, and with both of two', () => {
    const one = { raidRequirements: [key('a', { objectiveId: 'room' })] } as unknown as Quest
    expect([...questItemNeeds(one, new Set()).keys()]).toEqual(['a'])
    expect([...questItemNeeds(one, new Set(['room'])).keys()]).toEqual([])
    const two = { raidRequirements: [key('a', { objectiveId: 'room', objectiveIds: ['room', 'hall'] })] } as unknown as Quest
    expect([...questItemNeeds(two, new Set(['room'])).keys()]).toEqual(['a'])
    expect([...questItemNeeds(two, new Set(['room', 'hall'])).keys()]).toEqual([])
  })
})
