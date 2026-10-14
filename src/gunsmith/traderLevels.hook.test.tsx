import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Trader } from '../domain/types'

const app = vi.hoisted(() => ({ character: 'a'.repeat(24) as string | undefined }))
vi.mock('../state/AppState', () => ({ useOptionalAppState: () => ({ activeProfile: { modes: { pve: { logCharacterId: app.character } } } }) }))
const { saveScreenTraderLevels, useTraderLevels } = await import('./traderLevels')

const prapor: Trader = { id: 't-prapor', name: 'prapor', normalizedName: 'prapor', role: '', loyalty: 4, accent: '', levelPlayerLevels: [1, 15, 26, 36] }
const levelOf = () => renderHook(() => useTraderLevels('pve', [prapor], [], () => undefined, 40)).result.current.infos[0]!.level

beforeEach(() => localStorage.clear())

describe('the traders\' screen in «Оружейник» (audit P18)', () => {
  it('counts for the character the mode holds now, and not for the next one', () => {
    saveScreenTraderLevels('pve', 'a'.repeat(24), { prapor: 3 }, '2026-10-14T10:00:00.000Z')
    app.character = 'a'.repeat(24)
    expect(levelOf()).toBe(3)
    // A wipe: the logs' profile id of the mode changed.
    app.character = 'b'.repeat(24)
    expect(levelOf()).toBe(1)
  })
})
