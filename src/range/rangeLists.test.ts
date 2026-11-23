import { describe, expect, it } from 'vitest'
import type { GunPart } from '../arsenal/gunTypes'
import { groupScopes, modelKey, oneOfEachModel } from './rangeLists'
import type { ScopeData } from './rangeScope'

const scope = (id: string, extra: Partial<ScopeData['modes'][number]> = {}): ScopeData => ({ id, ru: id, en: id, modes: [{ zoom: 4, fovDeg: 6, ...extra }] })
const mount = (id: string, name: string, shortName: string, allowed: string[]) => ({ id, name, shortName, slots: [{ id: `${id}-s`, nameId: 'mod_scope', name: 'scope', required: false, allowed }] }) as unknown as GunPart

describe('the range lists in the owner\'s order (23.11.2026)', () => {
  it('groups the scopes: rings first, then rail, thermal, night, the service optics', () => {
    const parts = new Map<string, GunPart>([
      ['m1', mount('m1', 'Крепление 30мм Lobaev Arms для оптики', 'Lobaev 30мм', ['vudu'])],
      ['m2', mount('m2', 'Крепление Trijicon "TA51" для установки прицелов', 'TA51', ['acog'])],
    ])
    const groups = groupScopes([scope('acog'), scope('vudu'), scope('flir', { thermal: true }), scope('nspu', { night: true }), scope('5c82342f2e221644f31c060e')], parts)
    expect(groups.map((entry) => [entry.group, entry.scopes.map((item) => item.id)])).toEqual([
      ['rings', ['vudu']], ['rail', ['acog']], ['thermal', ['flir']], ['night', ['nspu']], ['service', ['5c82342f2e221644f31c060e']],
    ])
  })

  it('keeps one colour of a model, the one drawn worn', () => {
    const black = { id: 'b', name: 'Шлем Team Wendy "EXFIL Ballistic" (Черный)', armorClass: 4 }
    const coyote = { id: 'c', name: 'Шлем Team Wendy "EXFIL Ballistic" (Койот)', armorClass: 4 }
    const other = { id: 'o', name: 'Шлем "Алтын"', armorClass: 5 }
    expect(modelKey(black)).toBe(modelKey(coyote))
    expect(oneOfEachModel([coyote, black, other], (id) => id !== 'c').map((item) => item.id)).toEqual(['b', 'o'])
    expect(oneOfEachModel([coyote, black, other]).map((item) => item.id)).toEqual(['c', 'o'])
  })
})
