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

describe('quest card under the map: the pin at an objective', () => {
  it('stands to the left of the box on a line with its own point, not on a done one, and takes the map there', async () => {
    const onGoToPoint = vi.fn()
    const { container } = render(<QuestSheetObjectives sheet={sheet} trader="Егерь" onToggle={vi.fn()} pointOf={(id) => id !== 'none'} onGoToPoint={onGoToPoint} />)
    const pins = screen.getAllByRole('button', { name: 'Показать точку на карте' })
    expect(pins).toHaveLength(1)
    const line = container.querySelector('.sheet-objective') as HTMLElement
    expect(line.querySelector('button')).toBe(pins[0])
    expect(pins[0]!.nextElementSibling).toHaveClass('sheet-objective-tick')
    await userEvent.click(pins[0]!)
    expect(onGoToPoint).toHaveBeenCalledWith('kill-lighthouse')
  })

  it('a line without a point has no pin', () => {
    render(<QuestSheetObjectives sheet={sheet} trader="Егерь" onToggle={vi.fn()} pointOf={() => false} onGoToPoint={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Показать точку на карте' })).toBeNull()
  })
})

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

  it('the line\'s text ticks it as well, and the objective of the point tapped on the map is lit (owner, 02.11.2026: «Сделай более удобную отметку в телефонах»)', async () => {
    const onToggle = vi.fn()
    const { container } = render(<QuestSheetObjectives sheet={sheet} trader="Егерь" onToggle={onToggle} focusObjectiveId="kill-factory" />)
    await userEvent.click(screen.getByText('Устранить Диких на Маяке'))
    expect(onToggle.mock.calls).toEqual([['kill-lighthouse', true]])
    const [lighthouse, factory] = container.querySelectorAll('li')
    expect(factory).toHaveClass('is-focus')
    expect(lighthouse).not.toHaveClass('is-focus')
  })

  it('without onToggle (not a current quest, or the editor) only the done mark shows', () => {
    render(<QuestSheetObjectives sheet={sheet} trader="Егерь" />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByLabelText('Выполнено')).toBeInTheDocument()
  })

  it('an objective of the quest shown before never stays in the next one, even when a quest repeats an objective id (owner, 20.10.2026: «Недоброжелатель» → «Захват аванпоста» showed «Установить Подавитель…»)', () => {
    const line = (id: string, text: string) => ({ id, text, where: null, here: false, done: false })
    const illWill: SheetObjectives = { showWhere: false, groups: [{ kind: 'raid', title: 'В рейде', objectives: [line('same', 'Установить Подавитель сигналов на источнике сигнала'), line('same', 'Найти источник сигнала')] }] }
    const outposts: SheetObjectives = { showWhere: false, groups: [{ kind: 'raid', title: 'В рейде', objectives: [line('kill', 'Устранить бойцов ЧВК на базах Диких')] }] }
    const { container, rerender } = render(<QuestSheetObjectives sheet={illWill} trader="Механик" />)
    rerender(<QuestSheetObjectives sheet={outposts} trader="Прапор" />)
    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(container.textContent).not.toMatch(/Подавитель|источник сигнала/)
  })
})
