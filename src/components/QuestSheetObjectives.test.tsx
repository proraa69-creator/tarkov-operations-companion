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

describe('quest card under the map: «7/10» on an objective of more than one (report 144)', () => {
  const kills: SheetObjectives = { showWhere: false, groups: [{ kind: 'raid', title: 'В рейде', objectives: [
    { id: 'kill-10', text: 'Устранить Диких', count: 10, target: 10, current: 7, where: null, here: true, done: false },
    { id: 'one', text: 'Найти записку', where: null, here: true, done: false },
  ] }] }

  it('shows the count with − and +, and each sets the next value; a line of one has none', async () => {
    const onCount = vi.fn()
    const { container } = render(<QuestSheetObjectives sheet={kills} trader="Егерь" onToggle={vi.fn()} onCount={onCount} />)
    expect(container.querySelectorAll('.sheet-objective-counter')).toHaveLength(1)
    expect(screen.getByText('7/10')).toBeTruthy()
    // the counter replaces «×10»
    expect(screen.queryByText('×10')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Больше: Устранить Диких' }))
    await userEvent.click(screen.getByRole('button', { name: 'Меньше: Устранить Диких' }))
    expect(onCount.mock.calls).toEqual([['kill-10', 8], ['kill-10', 6]])
  })

  it('without a way to count (not a current quest), a count already made is still shown', () => {
    render(<QuestSheetObjectives sheet={kills} trader="Егерь" />)
    expect(screen.getByText('7/10')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Больше/ })).toBeNull()
  })
})

// Owner, 15.11.2026 («Инвазивная терапия»): «справа будут не требуемые предметы, а тоже надпись «Найти в рейде»… предметы, которые
// нам нужно найти, и количество»; what is planted is not there, «мы их уже изначально взяли».
describe('quest card under the map: «Найти в рейде» on the right', () => {
  it('lists what is to be found, with its count, and nothing that is planted; a key stays under «Требуемые предметы»', () => {
    const need = (itemId: string, name: string, purpose: 'find' | 'handover' | 'place' | 'key', count = 1) => ({ itemId, name, count, label: purpose, purpose })
    const therapy: SheetObjectives = {
      showWhere: true,
      groups: [
        { kind: 'place', title: 'Заложить', objectives: [{ id: 'plant', text: 'Заложить коктейль', where: 'Маяк', here: true, done: false, needs: [need('cocktail', 'Обдолбос', 'place')] }] },
        { kind: 'find', title: 'Найти в рейде', objectives: [{ id: 'find-p22', text: 'Найти P22', where: 'Любая карта', here: false, done: false, needs: [need('p22', 'P22', 'find', 2)] }] },
        { kind: 'handover', title: 'Сдать торговцу', objectives: [{ id: 'give-p22', text: 'Сдать P22', where: null, here: false, done: false, needs: [need('p22', 'P22', 'handover', 2)] }] },
        { kind: 'raid', title: 'В рейде', objectives: [{ id: 'door', text: 'Открыть дверь', where: 'Маяк', here: true, done: false, needs: [need('key', 'Ключ', 'key')] }] },
      ],
    } as SheetObjectives
    render(<QuestSheetObjectives sheet={therapy} trader="Терапевт" onToggle={vi.fn()} />)
    const find = screen.getByRole('region', { name: 'Найти в рейде' })
    expect(find).toHaveTextContent('P22 ×2')
    expect(find).not.toHaveTextContent('Обдолбос')
    expect(screen.getByRole('region', { name: 'Требуемые предметы' })).toHaveTextContent('Ключ')
    expect(document.querySelector('.sheet-needs-block')).not.toHaveTextContent('Обдолбос')
  })
})
