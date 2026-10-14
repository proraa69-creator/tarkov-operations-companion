import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Trader } from '../domain/types'
import { saveScreenTraderLevels, useTraderLevels } from './traderLevels'

const prapor: Trader = { id: 't-prapor', name: 'prapor', normalizedName: 'prapor', role: '', loyalty: 4, accent: '', levelPlayerLevels: [1, 15, 26, 36] }
const levelOf = (character: string | undefined) => renderHook(() => useTraderLevels('pve', [prapor], [], () => undefined, 40, character)).result.current.infos[0]!.level

beforeEach(() => localStorage.clear())

describe('the traders\' screen in «Оружейник» (audit P18)', () => {
  it('counts for the character the mode holds now, and not for the next one', () => {
    saveScreenTraderLevels('pve', 'a'.repeat(24), { prapor: 3 }, '2026-10-14T10:00:00.000Z')
    expect(levelOf('a'.repeat(24))).toBe(3)
    // A wipe: the logs' profile id of the mode changed.
    expect(levelOf('b'.repeat(24))).toBe(1)
    // Nothing known about the character yet: only a reading taken while it was unknown counts.
    expect(levelOf(undefined)).toBe(1)
    saveScreenTraderLevels('pve', undefined, { prapor: 2 }, '2026-10-14T10:00:00.000Z')
    expect(levelOf(undefined)).toBe(2)
  })
})
