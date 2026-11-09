import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Item } from '../domain/types'
import { KeySpotKeys } from './KeySpotKeys'

const items = new Map<string, Item>(Array.from({ length: 8 }, (_, index) => {
  const id = `k${index}`
  return [id, { id, name: `Ключ ${index}`, shortName: `К${index}`, iconUrl: `https://example.test/${id}-icon.webp`, category: 'Ключ' } as unknown as Item]
}))
const ids = [...items.keys()]

describe('«Ключи»: a spot of several keys as pictures (owner, 09.11.2026)', () => {
  it('shows six with their short names, then all on «Показать все»', () => {
    render(<KeySpotKeys keyIds={ids} items={items} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText('К0')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Показать все · 8/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
  })

  it('in the hover card: six and «+N», no button', () => {
    render(<KeySpotKeys keyIds={ids} items={items} compact />)
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText('+2')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
