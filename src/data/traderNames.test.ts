import { describe, expect, it } from 'vitest'
import { traderDisplayName } from './traderNames'
import { adaptTradersResponse } from '../restock/restockSource'

describe('trader names on screen', () => {
  it('never shows a tarkov.dev translation key or a bare id (owner, 12.10.2026: long strings in the restock)', () => {
    expect(traderDisplayName('54cb50c76803fa8b248b4571 Nickname', 'prapor')).toBe('Прапор')
    expect(traderDisplayName('69e0d6cc77b63940375b9173', 'survivor')).toBe('Выживший')
    expect(traderDisplayName('688246518448b05efd61d461 Nickname', 'mr-kerman')).toBe('Мистер Керман')
    expect(traderDisplayName('0123456789abcdef01234567 Nickname', 'new-trader')).toBe('New trader')
    expect(traderDisplayName('0123456789abcdef01234567 Nickname')).toBe('')
  })

  it('keeps a real name as it is', () => {
    expect(traderDisplayName('Прапор', 'prapor')).toBe('Прапор')
    expect(traderDisplayName(' Peacekeeper ', 'peacekeeper')).toBe('Peacekeeper')
  })

  it('the restock times use it too', () => {
    const [trader] = adaptTradersResponse({ data: { traders: [{ id: '54cb50c76803fa8b248b4571', name: '54cb50c76803fa8b248b4571 Nickname', normalizedName: 'prapor', resetTime: '2026-10-12T10:00:00Z' }] } })
    expect(trader!.name).toBe('Прапор')
  })
})
