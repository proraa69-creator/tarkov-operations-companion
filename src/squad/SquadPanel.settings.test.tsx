import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { SquadMine } from './socialClient'

const mine = vi.hoisted(() => ({ value: null as SquadMine | null }))
vi.mock('./useSquad', () => ({
  useSquad: () => ({ mine: mine.value, overview: null, loading: false, error: '', signedOut: false, loadedAt: 1, signedIn: true, reload: async () => {} }),
  useSquadComputed: () => null,
  invalidateSquads: () => {},
}))
const { SquadPanel } = await import('./SquadPanel')

const data = { quests: [], items: [], maps: [] }
const member = (memberId: string, nickname: string, isYou: boolean, isOwner: boolean) => ({ memberId, nickname, isYou, isOwner, joinedAt: '' })

describe('«Настройки отряда» for every player (owner, 14.11.2026: «должны быть у всех участников а не только у командира»)', () => {
  it('a member who is not the commander has them', () => {
    mine.value = { access: true, invitations: [], squad: { id: 'a'.repeat(32), name: 'Тройка', maxMembers: 5, isOwner: false, createdAt: '', members: [member('b'.repeat(24), 'Raid_OS', false, true), member('c'.repeat(24), 'Freyzo', true, false)] } }
    render(<MemoryRouter><SquadPanel mode="pve" data={data} friends={[]} /></MemoryRouter>)
    expect(screen.getByText('Настройки отряда')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Местоположение отряда' })).toBeInTheDocument()
  })

  it('a player not in a squad yet (an invitation waiting) has them too', () => {
    mine.value = { access: true, squad: null, invitations: [{ invitationId: 'd'.repeat(24), squadName: 'Тройка', from: 'Raid_OS', members: 1, expiresAt: '' }] }
    render(<MemoryRouter><SquadPanel mode="pve" data={data} friends={[]} /></MemoryRouter>)
    expect(screen.getByText('Приглашения в отряд')).toBeInTheDocument()
    expect(screen.getByText('Настройки отряда')).toBeInTheDocument()
  })
})
