import { describe, expect, it } from 'vitest'
import { backDelta, pageOf, recordPage } from './backHistory'

describe('«Назад» on the phone', () => {
  it('goes back to the last page with another path, skipping changes within a page', () => {
    recordPage(0, '/', true)
    recordPage(1, '/quests', true)
    recordPage(2, '/quests', true) // ?selected=…
    recordPage(3, '/quests', true)
    expect(backDelta(3)).toBe(-3)
    expect(backDelta(0)).toBeNull()
  })

  it('forgets the pages ahead after a new page is opened', () => {
    recordPage(0, '/', true)
    recordPage(1, '/maps', true)
    recordPage(2, '/flea', true)
    recordPage(1, '/maps', false) // back
    recordPage(2, '/maps', true) // ?quest=… replaces the forward entries
    expect(backDelta(2)).toBe(-2)
  })

  // owner, 20.11.2026: «нажимаю кнопку назад справа внизу, а меня выкидывает не в список оружия, а в обзор»
  it('from a Gunsmith weapon goes one step back to the list of weapons, then to the page before', () => {
    recordPage(0, '/', true)
    recordPage(1, pageOf({ pathname: '/gunsmith' }), true)
    recordPage(2, pageOf({ pathname: '/gunsmith', state: { gunsmithList: true } }), true) // ?quest=… opened as a window
    expect(backDelta(2)).toBe(-1)
    recordPage(1, pageOf({ pathname: '/gunsmith', state: null }), false) // back at the list
    expect(backDelta(1)).toBe(-1)
  })
})
