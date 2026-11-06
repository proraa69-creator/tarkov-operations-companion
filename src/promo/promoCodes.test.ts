import { beforeEach, describe, expect, it } from 'vitest'
import { markPromoCodesRead, parsePromoCodes, unreadPromoCodes, type PromoCode } from './promoCodes'

const row = (code: string, extra: Partial<PromoCode> = {}): PromoCode => ({ code, addedAt: '2026-11-06T10:00:00.000Z', ...extra })

describe('«Промокоды»', () => {
  beforeEach(() => localStorage.clear())

  it('reads only well-formed rows of the answer', () => {
    expect(parsePromoCodes({ codes: [row('WIPE', { mode: 'season' }), { code: 5 }, null, { code: 'NODATE' }] })).toEqual([row('WIPE', { mode: 'season' })])
    expect(parsePromoCodes({ nope: true })).toBeNull()
    expect(parsePromoCodes(null)).toBeNull()
  })

  it('the first batch is no news; a later code is, until the window was opened', () => {
    const list = [row('NEWONE'), row('OLD', { first: true })]
    expect(unreadPromoCodes(list, new Set()).map((entry) => entry.code)).toEqual(['NEWONE'])
    expect(unreadPromoCodes(list, new Set(['NEWONE']))).toEqual([])
    markPromoCodesRead(list)
    expect(JSON.parse(localStorage.getItem('raidos-promo-read-v1')!)).toEqual(['NEWONE', 'OLD'])
  })
})
