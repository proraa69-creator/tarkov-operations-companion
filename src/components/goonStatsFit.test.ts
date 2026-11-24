import { describe, expect, it } from 'vitest'
import { fitGoonStats } from './goonStatsFit'

/** Layout boxes jsdom does not compute, as the browser would give them for this arrangement. */
function define(element: HTMLElement, props: Record<string, () => number>) {
  for (const [name, get] of Object.entries(props)) Object.defineProperty(element, name, { configurable: true, get })
}

/**
 * The statistics of a card `height` px tall: the first row 46 px, the chips 50 px (25 px with one chip, data-fit 2;
 * hidden from 3), sightings rows 30 px apart.
 */
function card(height: number) {
  const stats = document.createElement('div')
  stats.style.padding = '12px 14px 10px 16px'
  const head = document.createElement('div')
  const chips = document.createElement('div')
  const list = document.createElement('ul')
  list.append(document.createElement('li'), document.createElement('li'))
  stats.append(head, chips, list)
  const fit = () => stats.dataset.fit ?? '0'
  const chipsHeight = () => (fit() === '0' || fit() === '1' ? 50 : fit() === '2' ? 25 : 0)
  define(stats, { clientHeight: () => height, offsetHeight: () => height })
  define(head, { offsetTop: () => 12, offsetHeight: () => 46 })
  define(chips, { offsetTop: () => 64, offsetHeight: chipsHeight })
  define(list, { offsetTop: () => 64 + (chipsHeight() ? chipsHeight() + 6 : 0), offsetHeight: () => parseFloat(list.style.height) || 0 })
  Array.from(list.children).forEach((row, index) => define(row as HTMLElement, { offsetTop: () => index * 30, offsetHeight: () => 26 }))
  const button = document.createElement('button')
  stats.getBoundingClientRect = () => ({ top: 0, right: 200, bottom: height, left: 0, width: 200, height, x: 0, y: 0, toJSON: () => ({}) })
  button.getBoundingClientRect = () => ({ top: 12, right: 190, bottom: 46, left: 130, width: 60, height: 34, x: 130, y: 12, toJSON: () => ({}) })
  return { stats, list, button }
}

// Owner, 08.11.2026: «проработай для каждого размера окна свое расположение внутренности ников и отметок кочевников».
describe('fitting the Goons statistics into the card', () => {
  it('keeps every chip and as many whole sightings rows as fit in a tall card', () => {
    const { stats, list, button } = card(220)
    fitGoonStats(stats, button, list)
    expect(stats.dataset.fit).toBe('0')
    // 220 − 10 (padding) − 120 (where the list starts) = 90: three rows of 30
    expect(list.style.height).toBe('90px')
  })

  it('drops the counts before the sightings, and never cuts a row', () => {
    const { stats, list, button } = card(130)
    fitGoonStats(stats, button, list)
    expect(stats.dataset.fit).toBe('3')
    expect(list.style.height).toBe('30px')
  })

  it('keeps the first row clear of «Видел» wherever it stands', () => {
    const { stats, list, button } = card(220)
    fitGoonStats(stats, button, list)
    // its room at the right (200 − 130, less the 14 px padding, plus 8 px of air) and down to its bottom (46 − 12 + 4)
    expect(stats.style.getPropertyValue('--goon-button')).toBe('64px')
    expect(stats.style.getPropertyValue('--goon-head')).toBe('38px')
  })

  it('leaves a card that is not laid out alone', () => {
    const { stats, list, button } = card(0)
    fitGoonStats(stats, button, list)
    expect(stats.dataset.fit).toBeUndefined()
  })
})
