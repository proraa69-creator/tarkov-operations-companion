import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SquadMapBoard } from './SquadMapBoard'

const members = [
  { memberId: 'a', label: 'Operator', index: 0 },
  { memberId: 'b', label: 'Wolfhound', index: 1 },
  { memberId: 'c', label: 'Nightowl_7', index: 2 },
]
const names = new Map(members.map((member) => [member.memberId, { label: member.label, index: member.index }]))
const QUESTS: Record<string, string> = { checking: 'Проверка', swag: 'Золотая добыча', water: 'Операция «Водолей»', pharm: 'Фармацевт' }

describe('SquadMapBoard', () => {
  it('shows every member\'s quest count per map and the shared quests with who has them', () => {
    render(<SquadMapBoard
      members={members}
      names={names}
      questName={(id) => QUESTS[id] ?? id}
      mapName={(id) => (id === 'customs' ? 'Таможня' : 'Лес')}
      maps={[
        { mapId: 'customs', sharedCount: 2, quests: [{ questId: 'swag', memberIds: ['a', 'b', 'c'] }, { questId: 'checking', memberIds: ['a', 'b'] }, { questId: 'water', memberIds: ['a'] }] },
        { mapId: 'woods', sharedCount: 0, quests: [{ questId: 'pharm', memberIds: ['c'] }] },
      ]}
    />)
    const customs = screen.getByText('Таможня').closest('article')!
    const rows = within(customs).getAllByRole('listitem').map((row) => row.textContent)
    expect(rows).toEqual(['OOperator3', 'WWolfhound2', 'NNightowl_71'])
    expect(within(customs).getByText('Золотая добыча').parentElement!.textContent).toContain('у всех')
    expect(within(customs).getByText('Проверка').parentElement!.textContent).toBe('ПроверкаOperatorWolfhound')
    const woods = screen.getByText('Лес').closest('article')!
    expect(woods.classList.contains('has-shared')).toBe(false)
    expect(within(woods).queryByText('Общие квесты')).toBeNull()
    expect(within(woods).getAllByRole('listitem').filter((row) => row.classList.contains('is-empty'))).toHaveLength(2)
  })
})
