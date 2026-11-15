import { describe, expect, it } from 'vitest'
import type { Item, Quest } from '../domain/types'
import { questItemRows } from './questItemRows'

/** Report 162: a quest's quest items in its card, with what to do with each. */
const item = (id: string) => ({ id, name: `Предмет ${id}`, shortName: id, category: 'Бартер', description: '', prices: [] }) as Item
const need = (itemId: string, purpose: 'find' | 'handover' | 'place', questItem = true) => ({ itemId, purpose, count: 1, mapIds: [], questItem })

describe('a quest\'s quest items', () => {
  it('say what to do with each, and leave out what is no quest item or has no name', () => {
    const quest = { raidRequirements: [
      need('blood', 'find'), need('blood', 'place'),
      need('tape', 'find'), need('tape', 'handover'),
      need('drive', 'place'),
      need('file', 'find'),
      need('letter', 'handover'),
      need('ledx', 'handover', false),
      need('unknown', 'place'),
    ] } as Pick<Quest, 'raidRequirements'>
    expect(questItemRows(quest, ['blood', 'tape', 'drive', 'file', 'letter', 'ledx'].map(item)).map((row) => [row.item.id, row.action])).toEqual([
      ['blood', 'Поднять и заложить'], ['tape', 'Найти и передать'], ['drive', 'Заложить'], ['file', 'Найти'], ['letter', 'Передать'],
    ])
  })
})
