import { describe, expect, it } from 'vitest'
import { keepManualEntries, manualQuest } from './manualQuests.mjs'

describe('the data generators keep the quests changed by hand as they were (owner, 23.11.2026)', () => {
  it('a rebuilt entry of a registered quest goes back to the old one; a quest it had none for gets none', () => {
    const previous = { '5b478eca86f7744642012254': { photos: ['old'] }, fresh: { photos: ['x'] } }
    const next = { '5b478eca86f7744642012254': { photos: ['old', 'emercom'] }, '639dbaf17c898a131e1cffff': { photos: ['new'] }, fresh: { photos: ['y'] } }
    expect(keepManualEntries(next, previous)).toEqual(['Витамины', 'Должник'])
    expect(next).toEqual({ '5b478eca86f7744642012254': { photos: ['old'] }, fresh: { photos: ['y'] } })
  })

  it('a fix for one mode keeps that mode only, and data of every mode only the fixes for every mode', () => {
    expect(manualQuest('67d03be712fb5f8fd2096332', 'seasonal')?.name).toBe('Освободить помещение')
    expect(manualQuest('67d03be712fb5f8fd2096332', 'pvp')).toBeUndefined()
    expect(manualQuest('67d03be712fb5f8fd2096332')).toBeUndefined()
    const next = { '67d03be712fb5f8fd2096332': { lines: ['new'] } }
    expect(keepManualEntries(next, {}, 'pvp')).toEqual([])
    expect(next).toEqual({ '67d03be712fb5f8fd2096332': { lines: ['new'] } })
  })
})
