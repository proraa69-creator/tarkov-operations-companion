import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { withOwnerGuides } from './ownerGunsmithGuides'

// Owner, 16.11.2026 (report 168): «Оружейник. АКМ» — his build, with ПТ АКМ and ПТ-1, over the sites' outdated one.
const akm = (guideParts: string[]): Quest => ({
  id: '5ae3270f86f77445ba41d4dd', name: 'Оружейник. АКМ',
  objectiveDetails: [{ id: 'o1', description: 'Модифицировать АКМ', build: {
    weaponId: '59d6088586f774275f37482f', partIds: ['59f8a37386f7747af3328f06', '59d6272486f77466146386ff'], attributes: [],
    guide: { source: 'tarkov.help', parts: guideParts.map((itemId) => ({ itemId, name: itemId, sellers: [] })) },
  } }],
} as unknown as Quest)

describe('the owner\'s Gunsmith builds', () => {
  it('replace the site\'s build of «Оружейник. АКМ»: ПТ АКМ and ПТ-1 in, the required parts marked', () => {
    const [quest] = withOwnerGuides([akm(['5649af884bdc2d1b2b8b4589', 'old-dust-cover'])])
    const guide = quest!.objectiveDetails![0]!.build!.guide!
    expect(guide.source).toBe('owner')
    const ids = guide.parts.map((part) => part.itemId)
    expect(ids).toContain('5b222d335acfc4771e1be099')
    expect(ids).toContain('5b222d405acfc400153af4fe')
    // both grips: SFG as in his screenshot, Fortis Shift for the task; no rear sight (the weapon's own)
    expect(ids).toContain('5f6340d3ca442212f4047eb2')
    expect(ids).toContain('59f8a37386f7747af3328f06')
    expect(ids).not.toContain('59d650cf86f7741b846413a4')
    expect(ids).not.toContain('old-dust-cover')
    expect(guide.parts.filter((part) => part.required).map((part) => part.itemId).sort()).toEqual(['59d6272486f77466146386ff', '59f8a37386f7747af3328f06'])
    expect(guide.parts.find((part) => part.itemId === '5b222d405acfc400153af4fe')!.name).toBe('Приклад Зенит "ПТ-1 Классика" для АК')
  })

  it('in English with English names; other tasks untouched', () => {
    const other = { ...akm([]), id: 'another-task' } as Quest
    const [quest, untouched] = withOwnerGuides([akm([]), other], true)
    expect(quest!.objectiveDetails![0]!.build!.guide!.parts[0]!.name).toBe('Fortis Shift tactical grip')
    expect(untouched).toBe(other)
  })
})
