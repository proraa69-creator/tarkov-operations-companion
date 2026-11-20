import { describe, expect, it } from 'vitest'
import { backDelta, recordPage } from './backHistory'

// owner, 20.11.2026: «нажимаю кнопку назад справа внизу, а меня выкидывает не в список оружия, а в обзор… должен делаться
// шаг назад в любом блоке»
describe('«Назад» on the phone', () => {
  it('goes one step back in any section: from a weapon, a quest or a card to the list it was opened from', () => {
    recordPage(0, '/', true)
    recordPage(1, '/gunsmith', true)
    recordPage(2, '/gunsmith', true) // ?quest=… — a Gunsmith weapon opened
    expect(backDelta(2)).toBe(-1)
    expect(backDelta(1)).toBe(-1)
    expect(backDelta(0)).toBeNull()
  })

  it('forgets the pages ahead after a new page is opened', () => {
    recordPage(0, '/', true)
    recordPage(1, '/maps', true)
    recordPage(2, '/flea', true)
    recordPage(1, '/maps', false) // back
    recordPage(2, '/maps', true) // ?quest=… replaces the forward entries
    expect(backDelta(2)).toBe(-1)
  })
})
