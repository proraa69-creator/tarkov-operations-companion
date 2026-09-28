import { describe, expect, it } from 'vitest'
import { canonicalMapId, localizeMapCopy, mapDisplayName } from './mapIds'

describe('map id aliases', () => {
  it('maps live and night variants onto the companion catalog', () => {
    expect(canonicalMapId('56f40101d2720b2a4d8b45d6')).toBe('56f40101d2720b2a4d8b45d6')
    expect(canonicalMapId('night-factory')).toBe('factory')
    expect(canonicalMapId('ground-zero-21')).toBe('ground-zero')
    expect(canonicalMapId('the-lab-dark')).toBe('the-lab')
    expect(canonicalMapId('streets')).toBe('streets-of-tarkov')
  })

  it('prints Russian names from the map list', () => {
    expect(mapDisplayName('customs')).toBe('Таможня')
    expect(mapDisplayName('reserve', [{ id: 'reserve', name: 'Резерв' }])).toBe('Резерв')
    expect(mapDisplayName('night-factory')).toBe('Завод')
    expect(localizeMapCopy('Выход PMC')).toBe('Выход ЧВК')
    expect(localizeMapCopy('Выход Scav')).toBe('Выход Диких')
  })
})
