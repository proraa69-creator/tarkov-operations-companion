import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { withOwnerGuides } from './ownerGunsmithGuides'

// Owner, 16.11.2026: «Оружейник. АКМ» — tarkov.help's build is right, only the ПТ АКМ lock and the ПТ-1 stock are missing.
const HELP_AKM = ['5648b4534bdc2d3d1c8b4580', '593d489686f7745c6255d58a', '5947f92f86f77427344a76b1', '59d6272486f77466146386ff',
  '59f8a37386f7747af3328f06', '5c1cdd302e221602b3137250', '5c1cdd512e22161b267d91ae', '5d2c76ed48f03532f2136169']
const akm = (guideParts?: string[]): Quest => ({
  id: '5ae3270f86f77445ba41d4dd', name: 'Оружейник. АКМ',
  objectiveDetails: [{ id: 'o1', description: 'Модифицировать АКМ', build: {
    weaponId: '59d6088586f774275f37482f', partIds: ['59f8a37386f7747af3328f06', '59d6272486f77466146386ff'], attributes: [],
    ...(guideParts ? { guide: { source: 'tarkov.help', url: 'https://tarkov.help/ru/quest/oruzhejnik-chast-6', image: 'shot.jpg',
      parts: guideParts.map((itemId) => ({ itemId, name: itemId, sellers: [] })) } } : {}),
  } }],
} as unknown as Quest)

describe('the owner\'s additions to Gunsmith builds', () => {
  it('«Оружейник. АКМ»: the site\'s build as it is, ПТ АКМ and ПТ-1 at its end', () => {
    const [quest] = withOwnerGuides([akm(HELP_AKM)])
    const guide = quest!.objectiveDetails![0]!.build!.guide!
    expect(guide.source).toBe('tarkov.help')
    expect(guide.image).toBe('shot.jpg')
    expect(guide.parts.map((part) => part.itemId)).toEqual([...HELP_AKM, '5b222d335acfc4771e1be099', '5b222d405acfc400153af4fe'])
    expect(guide.parts.at(-1)!.name).toBe('Приклад Зенит "ПТ-1 Классика" для АК')
  })

  it('nothing twice once the site lists them; no build made up without the site\'s; other tasks untouched', () => {
    const full = akm([...HELP_AKM, '5b222d335acfc4771e1be099', '5b222d405acfc400153af4fe'])
    expect(withOwnerGuides([full])[0]).toEqual(full)
    const bare = akm()
    expect(withOwnerGuides([bare])[0]).toBe(bare)
    const other = { ...akm(HELP_AKM), id: 'another-task' } as Quest
    expect(withOwnerGuides([other])[0]).toBe(other)
  })

  it('English names in the English catalog', () => {
    const [quest] = withOwnerGuides([akm(HELP_AKM)], true)
    expect(quest!.objectiveDetails![0]!.build!.guide!.parts.at(-2)!.name).toBe('AKM Zenit PT Lock')
  })
})
