import { describe, expect, it } from 'vitest'
import { aggregateRaidNeeds, ammoCaliber, ammoPackGroupLabel, formatItemCountLabel, groupAlternatives, isAmmoPack, type RaidNeedItem } from './raidNeeds'

// «Сорвать сделку» (break-the-deal): tarkov.dev lists every 7.62x51 pack as an alternative of one plant objective.
const PACKS: Array<[string, string, string]> = [
  ['65702566bfc87b3a3409324d', 'ТПЗ SP', 'TCW SP'],
  ['65702561cfc010a0f5006a28', 'БПЗ FMJ', 'BCP FMJ'],
  ['6570255dbfc87b3a3409324a', 'Ultra Nosler', 'Ultra Nosler'],
  ['65702558cfc010a0f5006a25', 'M80', 'M80'],
  ['65702554bfc87b3a34093247', 'M62 Tracer', 'M62 Tracer'],
  ['6570254fcfc010a0f5006a22', 'M61', 'M61'],
  ['648984e3f09d032aa9399d53', 'M993', 'M993'],
  ['6769b8e3c1a1466c850658a8', 'M80A1', 'M80A1'],
]
const items = new Map<string, RaidNeedItem>([
  ...PACKS.map(([id, ru]): [string, RaidNeedItem] => [id, { id, name: `Пачка патронов 7.62x51мм ${ru} (20 штук)`, types: ['ammoBox'] }]),
  ['57ac965c24597706be5f975c', { id: '57ac965c24597706be5f975c', name: 'Оптический прицел ELCAN "SpecterDR 1x/4x"', types: ['mods'] }],
  ['57aca93d2459771f2c7e26db', { id: '57aca93d2459771f2c7e26db', name: 'Оптический прицел ELCAN "SpecterDR 1x/4x" (FDE)', types: ['mods'] }],
  ['5991b51486f77447b112d44f', { id: '5991b51486f77447b112d44f', name: 'Маркер MS2000', types: ['barter'] }],
  ['556-pack', { id: '556-pack', name: 'Пачка патронов 5.56x45мм M855 (30 штук)', types: ['ammoBox'] }],
])
const lookup = (id: string) => items.get(id)
const breakTheDeal = PACKS.map(([itemId]) => ({ itemId, count: 1, purpose: 'place', questName: 'Сорвать сделку', objectiveId: 'break-the-deal-stash', alternatives: PACKS.length }))
const elcan = ['57ac965c24597706be5f975c', '57aca93d2459771f2c7e26db'].map((itemId) => ({ itemId, count: 1, purpose: 'place', questName: 'Оружейник', objectiveId: 'scope-stash', alternatives: 2 }))

describe('groupAlternatives', () => {
  it('turns the eight 7.62x51 packs of «Сорвать сделку» into one «Любая пачка патронов 7.62x51» line', () => {
    const marker = { itemId: '5991b51486f77447b112d44f', count: 1, purpose: 'mark', questName: 'БП Топливо', objectiveId: 'fuel-mark', alternatives: 1 }
    const grouped = groupAlternatives([...breakTheDeal, marker], lookup)
    expect(grouped.requirements.map((requirement) => requirement.itemId)).toEqual(['ammo-pack:7.62x51', '5991b51486f77447b112d44f'])
    expect(grouped.groups.get('ammo-pack:7.62x51')).toEqual({ id: 'ammo-pack:7.62x51', kind: 'ammo-pack', caliber: '7.62x51', itemIds: PACKS.map(([id]) => id) })
    // one pack is needed, not one of each variant
    expect(aggregateRaidNeeds(grouped.requirements)).toEqual([
      { itemId: 'ammo-pack:7.62x51', count: 1, lines: [{ purpose: 'place', count: 1, questNames: ['Сорвать сделку'] }], fromRaidListOnly: false },
      { itemId: '5991b51486f77447b112d44f', count: 1, lines: [{ purpose: 'mark', count: 1, questNames: ['БП Топливо'] }], fromRaidListOnly: false },
    ])
    expect(ammoPackGroupLabel('7.62x51')).toBe('Любая пачка патронов 7.62x51')
    expect(ammoPackGroupLabel('7.62x51', 'en')).toBe('Any 7.62x51 ammo pack')
  })

  it('turns other alternatives (the two ELCAN colours) into one «any of» line', () => {
    const grouped = groupAlternatives([...elcan, ...breakTheDeal], lookup)
    expect(grouped.requirements.map((requirement) => requirement.itemId)).toEqual(['any-of:scope-stash', 'ammo-pack:7.62x51'])
    expect(grouped.groups.get('any-of:scope-stash')).toEqual({ id: 'any-of:scope-stash', kind: 'any-of', itemIds: ['57ac965c24597706be5f975c', '57aca93d2459771f2c7e26db'] })
    expect(aggregateRaidNeeds(grouped.requirements)[0]).toMatchObject({ itemId: 'any-of:scope-stash', count: 1 })
  })

  it('merges packs of different calibers as «any of», and leaves single items alone', () => {
    const mixed = [
      { itemId: '65702558cfc010a0f5006a25', count: 1, purpose: 'place', objectiveId: 'mixed', alternatives: 2 },
      { itemId: '556-pack', count: 1, purpose: 'place', objectiveId: 'mixed', alternatives: 2 },
      { itemId: '6570254fcfc010a0f5006a22', count: 2, purpose: 'bring', objectiveId: 'single', alternatives: 1 },
    ]
    const grouped = groupAlternatives(mixed, lookup)
    expect(grouped.requirements.map((requirement) => requirement.itemId)).toEqual(['any-of:mixed', '6570254fcfc010a0f5006a22'])
    expect(grouped.groups.get('any-of:mixed')?.kind).toBe('any-of')
  })

  it('sums the same «any pack» across quests and keeps the objective count', () => {
    const second = PACKS.slice(0, 3).map(([itemId]) => ({ itemId, count: 2, purpose: 'place', questName: 'Другой тайник', objectiveId: 'other-stash', alternatives: 3 }))
    const rows = aggregateRaidNeeds(groupAlternatives([...breakTheDeal, ...second], lookup).requirements)
    expect(rows).toEqual([{ itemId: 'ammo-pack:7.62x51', count: 3, lines: [{ purpose: 'place', count: 3, questNames: ['Сорвать сделку', 'Другой тайник'] }], fromRaidListOnly: false }])
    expect(formatItemCountLabel(ammoPackGroupLabel('7.62x51'), rows[0].count)).toBe('Любая пачка патронов 7.62x51 ×3')
  })
})

describe('ammo pack detection', () => {
  it('prefers the item data and reads the name only without it', () => {
    expect(isAmmoPack({ id: 'a', name: 'Пачка патронов 7.62x51мм M80 (20 штук)' })).toBe(true)
    expect(isAmmoPack({ id: 'a', name: '7.62x51mm M80 ammo pack (20 pcs)' })).toBe(true)
    // the type list wins over a name that mentions the caliber
    expect(isAmmoPack({ id: 'm', name: 'Магазин на 10 патронов 7.62x51 для M1A', types: ['mods'] })).toBe(false)
    expect(isAmmoPack({ id: 'a', name: 'Ammo crate', types: ['ammoBox', 'noFlea'] })).toBe(true)
  })

  it('takes the caliber from the data field, otherwise from the name', () => {
    expect(ammoCaliber({ id: 'a', name: 'Ammo crate', caliber: 'Caliber762x51' })).toBe('7.62x51')
    expect(ammoCaliber({ id: 'a', name: 'Демо', caliber: '5.56×45' })).toBe('5.56x45')
    expect(ammoCaliber({ id: 'a', name: '7.62x51mm M80 ammo pack (20 pcs)' })).toBe('7.62x51')
    expect(ammoCaliber({ id: 'a', name: 'Пачка патронов 7.62x54мм R ЛПС гж (20 штук)' })).toBe('7.62x54R')
    expect(ammoCaliber({ id: 'a', name: 'Пачка патронов 12/70 картечь 7мм (25 штук)' })).toBe('12/70')
    expect(ammoCaliber({ id: 'a', name: 'Пачка патронов' })).toBeUndefined()
  })
})

describe('aggregateRaidNeeds', () => {
  it('merges identical items into one row with a total count', () => {
    const rows = aggregateRaidNeeds([
      { itemId: 'ms2000', count: 1, purpose: 'mark', questName: 'БП Топливо' },
      { itemId: 'ms2000', count: 1, purpose: 'mark', questName: 'БП Топливо' },
      { itemId: 'ms2000', count: 1, purpose: 'mark', questName: 'БП Топливо' },
      { itemId: 'ms2000', count: 1, purpose: 'mark', questName: 'БП Топливо' },
      { itemId: 'propane', count: 1, purpose: 'place', questName: 'Газовые баллоны' },
      { itemId: 'propane', count: 1, purpose: 'place', questName: 'Газовые баллоны' },
    ])

    expect(rows).toEqual([
      {
        itemId: 'ms2000',
        count: 4,
        lines: [{ purpose: 'mark', count: 4, questNames: ['БП Топливо'] }],
        fromRaidListOnly: false,
      },
      {
        itemId: 'propane',
        count: 2,
        lines: [{ purpose: 'place', count: 2, questNames: ['Газовые баллоны'] }],
        fromRaidListOnly: false,
      },
    ])
    expect(formatItemCountLabel('Маркер MS2000', 4)).toBe('Маркер MS2000 ×4')
    expect(formatItemCountLabel('Баллон пропана', 2)).toBe('Баллон пропана ×2')
  })

  it('keeps manually added raid-list items without quest lines', () => {
    expect(aggregateRaidNeeds([], ['salewa'])).toEqual([
      { itemId: 'salewa', count: 1, lines: [], fromRaidListOnly: true },
    ])
  })
})
