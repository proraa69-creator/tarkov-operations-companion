import { afterEach, describe, expect, it } from 'vitest'
import { dayNightPalette, nightShare, paintDayNight, stopDayNight } from './dayNight'

/**
 * «Смена дня и ночи» at night (owner, 28.11.2026: «в смене дня и ночи сделай тему, как у нас в зимнем северное сияние, только без
 * северного сияния… вместо розового, фиолетового… ночь переходит в такой звездный… а потом будет светлеть»).
 */
describe('day and night: the starry night', () => {
  afterEach(() => stopDayNight())

  it('the night is «Северное сияние»\'s deep blue, no more violet', () => {
    const night = dayNightPalette(1)
    expect(night.bg).toBe('rgb(4 7 14)')
    expect(night.brass).toBe('rgb(79 227 164)')
    // the day is the overcast olive it was
    expect(dayNightPalette(13).bg).toBe('rgb(28 32 36)')
  })

  it('the stars all night, rising over the dusk, fading over the dawn, none by day', () => {
    expect(nightShare(23)).toBe(1)
    expect(nightShare(3)).toBe(1)
    expect(nightShare(20.5)).toBeCloseTo(0.5, 5)
    expect(nightShare(5.5)).toBeCloseTo(0.5, 5)
    expect(nightShare(6.5)).toBe(0)
    expect(nightShare(12)).toBe(0)
    expect(nightShare(19.5)).toBe(0)
  })

  it('paints the stars\' strength and the night\'s blocks at night, takes them away by day and when the scheme is left', () => {
    const root = document.documentElement
    paintDayNight(2)
    expect(root.style.getPropertyValue('--dn-night')).toBe('1.000')
    expect(root.hasAttribute('data-daynight-night')).toBe(true)
    paintDayNight(12)
    expect(root.style.getPropertyValue('--dn-night')).toBe('0.000')
    expect(root.hasAttribute('data-daynight-night')).toBe(false)
    paintDayNight(23)
    stopDayNight()
    expect(root.style.getPropertyValue('--dn-night')).toBe('')
    expect(root.hasAttribute('data-daynight-night')).toBe(false)
  })
})
