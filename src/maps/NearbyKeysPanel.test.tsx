import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Item, Quest } from '../domain/types'
import { NearbyKeysPanel } from './NearbyKeysPanel'

const items = new Map<string, Item>([
  ['k1', { id: 'k1', name: 'Ключ от общаги 114', shortName: '114', iconUrl: 'https://example.test/k1-icon.webp' } as unknown as Item],
  ['k2', { id: 'k2', name: 'Ключ от склада', shortName: 'Склад', iconUrl: 'https://example.test/k2-icon.webp' } as unknown as Item],
])
const keys = [
  { keyId: 'k1', quests: [{ name: 'Знакомство' } as Quest], spots: [] },
  { keyId: 'k2', quests: [{ name: 'Логистика' } as Quest], spots: [] },
]

describe('«Ключи рядом»: the keys only, a key\'s card over the list (owner, 19.11.2026)', () => {
  it('no buttons to the spawn; a key opens its card, «Назад» brings the list back', () => {
    render(<NearbyKeysPanel keys={keys} items={items} folded={false} onFold={() => {}} onClose={() => {}} keyCard={(id) => <p>card {id}</p>} />)
    expect(screen.queryByTitle('Показать на карте')).toBeNull()
    expect(screen.queryByText('Где')).toBeNull()
    fireEvent.click(screen.getByTitle('Ключ от склада'))
    expect(screen.getByText('card k2')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Назад'))
    expect(screen.queryByText('card k2')).toBeNull()
  })

  it('«Свернуть» folds it into a chip (the spawns stay on the map, unlit); the chip opens it again', () => {
    const onFold = vi.fn()
    const { rerender } = render(<NearbyKeysPanel keys={keys} items={items} folded={false} onFold={onFold} onClose={() => {}} keyCard={() => null} />)
    fireEvent.click(screen.getByLabelText('Свернуть'))
    expect(onFold).toHaveBeenLastCalledWith(true)
    rerender(<NearbyKeysPanel keys={keys} items={items} folded onFold={onFold} onClose={() => {}} keyCard={() => null} />)
    fireEvent.click(screen.getByText(/Ключи рядом · 2/))
    expect(onFold).toHaveBeenLastCalledWith(false)
  })
})
