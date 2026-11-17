import { describe, expect, it } from 'vitest'
import { BOSS_LOADOUT } from './bossLoadout'

describe('«Ценный лут» from the players (reports 188, 189)', () => {
  it('Shadow of Tagilla: the Labrys notes and keycard Mechanic asks for; his Labrys and mask still noted', () => {
    const shadow = BOSS_LOADOUT['tagilla-2']!
    expect(shadow.loot?.map((ref) => ref.ids?.[0])).toEqual(['679b992329acd1f2f60985a5', '679b9819a2f2dd4da9023512'])
    expect(shadow.loot?.[0]?.note?.ru).toBe('Документы для Механика: 5 шт. на задание «Проверка гипотез»')
    expect(shadow.loot?.[1]?.note?.en).toContain('Offensive Reconnaissance')
    expect(shadow.note?.ru).toBe('Секира и маска с него не снимаются.')
  })

  it('Birdeye: the NICE COMM 3 BVS first — always on him, small inside, heavy, wanted by Ragman', () => {
    const backpack = BOSS_LOADOUT['goon-1']!.loot![0]!
    expect(backpack.ids).toEqual(['628bc7fb408e2b2e9c0801b1'])
    expect(backpack.note?.ru).toMatch(/Всегда при нём.*14 ячеек.*15 кг.*Специальное предложение/)
    expect(backpack.market).toBe(true)
    expect(backpack.note?.en).toMatch(/Always on him.*14 slots.*15 kg.*Special Offer/)
  })
})
