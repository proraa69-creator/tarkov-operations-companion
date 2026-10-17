import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QuestSheetObjectives } from './QuestSheetObjectives'
import type { SheetObjectives } from '../progression/sheetObjectives'

vi.mock('./QuestSheetEditing', () => ({ EditableText: ({ children, value }: { children?: React.ReactNode; value: string }) => <>{children ?? value}</> }))

const sheet: SheetObjectives = {
  showWhere: true,
  groups: [{ kind: 'raid', title: 'В рейде', objectives: [
    { id: 'kill-lighthouse', text: 'Устранить Диких на Маяке', where: 'Маяк', here: true, done: false },
    { id: 'kill-factory', text: 'Устранить Диких на Заводе', where: 'Завод', here: false, done: true },
  ] }],
}

describe('quest card under the map: «галочка» on an objective', () => {
  it('a current quest: every line has a box, a click ticks or unticks that objective', async () => {
    const onToggle = vi.fn()
    render(<QuestSheetObjectives sheet={sheet} trader="Егерь" onToggle={onToggle} />)
    const [lighthouse, factory] = screen.getAllByRole('button')
    expect(lighthouse).toHaveAttribute('aria-pressed', 'false')
    expect(factory).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(lighthouse)
    await userEvent.click(factory)
    expect(onToggle.mock.calls).toEqual([['kill-lighthouse', true], ['kill-factory', false]])
  })

  it('without onToggle (not a current quest, or the editor) only the done mark shows', () => {
    render(<QuestSheetObjectives sheet={sheet} trader="Егерь" />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByLabelText('Выполнено')).toBeInTheDocument()
  })
})
