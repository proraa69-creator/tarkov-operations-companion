import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KEY_TURN_MS, RaidRequirementsPanel, type RaidNeedRow } from './RaidRequirementsPanel'

// Report №90: «ключ 219 или ключ 220» — one card, «+1», the keys taking turns (owner, 07.11.2026: «каждые 3 секунды менялась картинка»).
const either: RaidNeedRow = {
  key: 'any-of:generators', itemId: 'k219', name: 'Ключ 219', iconUrl: '/219.webp', href: '/maps/shoreline', count: 1,
  lines: [{ purpose: 'key', questNames: ['Нужно больше энергии'] }], fromRaidListOnly: false,
  alternatives: { title: 'Можно и этим ключом', items: [{ id: 'k220', name: 'Ключ 220', iconUrl: '/220.webp' }], badge: '+1', turn: true },
}

describe('either key in «Требования рейда»', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows one key with «+1», then the other in its turn', () => {
    const { container } = render(<MemoryRouter><RaidRequirementsPanel rows={[either]} /></MemoryRouter>)
    expect(container.querySelectorAll('.raid-need')).toHaveLength(1)
    expect(screen.getByText('Ключ 219')).toBeTruthy()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(container.querySelector('.raid-need img')?.getAttribute('src')).toBe('/219.webp')
    act(() => { vi.advanceTimersByTime(KEY_TURN_MS) })
    expect(screen.getByText('Ключ 220')).toBeTruthy()
    expect(container.querySelector('.raid-need img')?.getAttribute('src')).toBe('/220.webp')
    act(() => { vi.advanceTimersByTime(KEY_TURN_MS) })
    expect(screen.getByText('Ключ 219')).toBeTruthy()
  })

  it('stays on one key with reduced motion, and for any other choice', () => {
    const matchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      render(<MemoryRouter><RaidRequirementsPanel rows={[either, { ...either, key: 'scope', name: 'ELCAN', alternatives: { ...either.alternatives!, turn: undefined } }]} /></MemoryRouter>)
      act(() => { vi.advanceTimersByTime(KEY_TURN_MS * 2) })
      expect(screen.getByText('Ключ 219')).toBeTruthy()
      expect(screen.queryByText('Ключ 220')).toBeNull()
      expect(screen.getByText('ELCAN')).toBeTruthy()
    } finally {
      window.matchMedia = matchMedia
    }
  })
})
// Owner, 07.11.2026: «если он у меня есть… пишется «Есть в схроне». Если нету, то пишется «Нет в наличии»».
describe('a key the player has or not', () => {
  it('says «Есть в схроне» or «Нет в наличии», and nothing when not known', () => {
    const key = (stock?: 'owned' | 'missing'): RaidNeedRow => ({ ...either, key: `k-${stock}`, name: `Ключ ${stock}`, alternatives: undefined, stock })
    render(<MemoryRouter><RaidRequirementsPanel rows={[key('owned'), key('missing'), key(undefined)]} /></MemoryRouter>)
    expect(screen.getByText('Ключ owned').closest('.raid-need')).toHaveTextContent('Есть в схроне')
    expect(screen.getByText('Ключ missing').closest('.raid-need')).toHaveTextContent('Нет в наличии')
    expect(screen.getByText('Ключ undefined').closest('.raid-need')?.textContent).not.toMatch(/в схроне|в наличии/)
  })
})

