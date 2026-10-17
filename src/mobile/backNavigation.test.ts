import { describe, expect, it } from 'vitest'
import { backDelta, recordPage } from './backNavigation'

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
})
