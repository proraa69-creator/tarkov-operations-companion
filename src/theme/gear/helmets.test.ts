import { describe, expect, it } from 'vitest'
import { availableHelmets } from './helmets'

// Owner, 13.11.2026: «Килла НГ» — «добавим маску 1 декабря».
describe('the mask list', () => {
  const ids = (iso: string) => availableHelmets(Date.parse(iso)).map((helmet) => helmet.id)
  it('offers «Килла НГ» from 1 December (Moscow), not before', () => {
    expect(ids('2026-11-30T20:59:00Z')).not.toContain('killa-ng')
    expect(ids('2026-11-30T21:00:00Z')).toContain('killa-ng')
    expect(ids('2026-11-13T12:00:00Z')).toEqual(['original', 'killa', 'knight', 'pumpkin'])
  })
})
