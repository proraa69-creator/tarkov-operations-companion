import { describe, expect, it } from 'vitest'
import { matchWikiMarker, wikiMapGuestScript, wikiSearchTokens } from './wikiMapPin'

describe('wiki map quest pinning', () => {
  it('matches a quest to a wiki marker even when the floor name is not used', () => {
    const markers = [
      { id: '15', categoryId: 'spawn_pmc', popup: { title: 'Спавн ЧВК' } },
      { id: '206', categoryId: 'locked', popup: { title: 'Комната 206', description: '2-й этаж общежития' } },
    ]
    expect(matchWikiMarker(markers, ['Операция «Водолей»', 'Найти спрятанную воду в комнате 206'])).toBe('206')
    expect(wikiSearchTokens(['Комната 206'])).toContain('206')
  })

  it('ignores unrelated markers when nothing matches', () => {
    expect(matchWikiMarker([{ id: '1', popup: { title: 'Спавн ЧВК' } }], ['Ищейка'])).toBeUndefined()
  })

  it('injects calibrated quest pins into the wiki Leaflet map', () => {
    const script = wikiMapGuestScript({
      searchTerms: ['Мокрое дело. Часть 2'],
      pins: [{ id: 'wet-job-2', title: 'Мокрое дело. Часть 2', x: 235.56, z: 442.02, focused: true }],
      landmarks: [{ name: 'Тоннель', x: 376.36, z: 319.25 }],
    })
    expect(script).toContain('__reactFiber')
    expect(script).toContain('toc-quest-pin')
    expect(script).toContain('Мокрое дело. Часть 2')
    expect(script).toContain('235.56')
    expect(script).toContain('Тоннель')
  })
})
