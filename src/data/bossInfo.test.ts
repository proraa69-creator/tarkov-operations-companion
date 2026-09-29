import { describe, expect, it } from 'vitest'
import { BOSS_NAMES, bossMapIds } from './bossFigures'
import { BOSS_INFO, GALLERY_BOSS_KEYS } from './bossInfo'

describe('Gallery boss descriptions', () => {
  const all = [...GALLERY_BOSS_KEYS.main, ...GALLERY_BOSS_KEYS.ancient]

  it('lists every boss once, with a name and a bilingual description', () => {
    expect(new Set(all).size).toBe(all.length)
    for (const key of all) {
      expect(BOSS_NAMES[key], key).toBeDefined()
      const info = BOSS_INFO[key]
      expect(info, key).toBeDefined()
      for (const text of [info.role, info.about, info.weapons, info.loot]) {
        if (text) { expect(text.ru.trim(), key).not.toBe(''); expect(text.en.trim(), key).not.toBe('') }
      }
    }
  })

  it('shows main bosses on the owner’s maps and keeps ancient ones off the maps', () => {
    for (const key of GALLERY_BOSS_KEYS.main) expect(bossMapIds(key).length, key).toBeGreaterThan(0)
    for (const key of GALLERY_BOSS_KEYS.ancient) {
      expect(bossMapIds(key), key).toEqual([])
      expect(BOSS_INFO[key].health, key).toBeUndefined()
    }
  })
})
