import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PhoneOverviewBlock } from './PhoneOverviewBlock'
import type { PhoneOverview } from './usePhoneOverview'

const overview = (narrow: string[] = [], sizes?: Record<string, { w?: number; h?: number }>) => ({
  layout: { order: ['raid'], narrow, ...(sizes ? { sizes } : {}) },
  editing: true, isDefault: !sizes, register: vi.fn(), toggleEditing: vi.fn(), reset: vi.fn(), move: vi.fn(), toggleNarrow: vi.fn(), resize: vi.fn(), setHalf: vi.fn(),
}) as unknown as PhoneOverview & { resize: ReturnType<typeof vi.fn> }

// Owner, 11.11.2026: «убери ручное редактирование окон. Должна быть кнопка только «разложить широко» или «пополам».
describe('«Настроить блоки» on the phone: wide or half, nothing by hand', () => {
  it('no corner to drag and no «Размер по умолчанию»; the half / wide button stays', () => {
    render(<PhoneOverviewBlock overview={overview()} id="raid" label="План рейда" index={0} count={1}><p>map</p></PhoneOverviewBlock>)
    expect(screen.queryByRole('button', { name: 'Изменить размер' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Размер по умолчанию' })).toBeNull()
  })

  it('a size set by hand before is no longer drawn: the block is wide, or half when halved', () => {
    const { unmount } = render(<PhoneOverviewBlock overview={overview([], { raid: { w: 0.4, h: 180 } })} id="raid" label="План рейда"><p>map</p></PhoneOverviewBlock>)
    const block = document.querySelector('.phone-block') as HTMLElement
    expect(block.style.getPropertyValue('--w')).toBe('1')
    expect(block.style.getPropertyValue('--h')).toBe('')
    unmount()
    render(<PhoneOverviewBlock overview={overview(['raid'])} id="raid" label="План рейда"><p>map</p></PhoneOverviewBlock>)
    expect((document.querySelector('.phone-block') as HTMLElement).style.getPropertyValue('--w')).toBe('0.5')
  })
})
