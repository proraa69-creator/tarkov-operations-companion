import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item, Quest } from '../domain/types'
import { DEFERRED_BLINK_WINDOW_MS, DEFERRED_GLOW_MS, DeferredQuestsButton, DeferredQuestsDialog, QuestDeferMenu } from './DeferredQuests'

const item = (id: string, name: string): Item => ({ id, name, shortName: id, category: 'Ключ', description: '', prices: [], iconUrl: `https://assets.example/${id}.webp` })
const quest = (id: string, name: string): Quest => ({ id, name, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] })
const rows = [
  { quest: quest('checking', 'Проверка'), detail: 'Прапор · Таможня', items: [item('machinery', 'Ключ от спецтехники'), item('marker', 'Маркер MS2000'), item('flash', 'Флешка')] },
  { quest: quest('aquarius', 'Операция «Водолей»'), detail: 'Терапевт · Таможня', items: [item('dorm-206', 'Ключ от комнаты 206')] },
  { quest: quest('debut', 'Дебют'), detail: 'Прапор · Таможня', items: [] },
]

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('«Отложенные квесты»: the button', () => {
  it('shows the count inside and glows when the page opens with quests put aside', () => {
    vi.useFakeTimers()
    render(<DeferredQuestsButton count={2} onOpen={() => {}} />)
    const button = screen.getByRole('button', { name: 'Отложенные квесты: 2' })
    expect(button).toHaveTextContent('Отложенные квесты2')
    expect(button).toHaveClass('has-deferred', 'is-glowing')
    // Three soft swells, then it stays still.
    act(() => { vi.advanceTimersByTime(DEFERRED_GLOW_MS) })
    expect(button).not.toHaveClass('is-glowing')
  })

  it('has no count and no glow without quests put aside; one put aside later on the page does not make it glow', () => {
    vi.useFakeTimers()
    const view = render(<DeferredQuestsButton count={0} onOpen={() => {}} />)
    const button = screen.getByRole('button', { name: 'Отложенные квесты' })
    expect(button).not.toHaveClass('is-glowing')
    act(() => { vi.advanceTimersByTime(DEFERRED_BLINK_WINDOW_MS + 1) })
    view.rerender(<DeferredQuestsButton count={1} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: 'Отложенные квесты: 1' })).not.toHaveClass('is-glowing')
  })

  it('still glows when the quests show up a moment after the page opened (they were loading)', () => {
    vi.useFakeTimers()
    const view = render(<DeferredQuestsButton count={0} onOpen={() => {}} />)
    act(() => { vi.advanceTimersByTime(800) })
    view.rerender(<DeferredQuestsButton count={3} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: 'Отложенные квесты: 3' })).toHaveClass('is-glowing')
  })
})

describe('«Отложенные квесты»: the right-click menu', () => {
  it('«У меня нет этого квеста» for a quest the player can give up, not for a chapter', () => {
    const onDismiss = vi.fn()
    const onClose = vi.fn()
    const view = render(<QuestDeferMenu menu={{ questId: 'checking', title: 'Проверка', x: 40, y: 50, canDismiss: true }} onDefer={vi.fn()} onDismiss={onDismiss} onClose={onClose} />)
    expect(within(screen.getByRole('menu', { name: 'Меню квеста' })).getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual(['Отложить квест', 'У меня нет этого квеста'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'У меня нет этого квеста' }))
    expect(onDismiss).toHaveBeenCalledWith('checking')
    expect(onClose).toHaveBeenCalled()
    view.rerender(<QuestDeferMenu menu={{ questId: 'story-tour', title: 'Тур', x: 40, y: 50 }} onDefer={vi.fn()} onDismiss={onDismiss} onClose={onClose} />)
    expect(screen.queryByRole('menuitem', { name: 'У меня нет этого квеста' })).toBeNull()
  })

  it('has one item that puts the quest aside; Escape closes it', () => {
    const onDefer = vi.fn()
    const onClose = vi.fn()
    const view = render(<QuestDeferMenu menu={{ questId: 'checking', title: 'Проверка', x: 40, y: 50 }} onDefer={onDefer} onClose={onClose} />)
    const menu = screen.getByRole('menu', { name: 'Меню квеста' })
    expect(within(menu).getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual(['Отложить квест'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Отложить квест' }))
    expect(onDefer).toHaveBeenCalledWith('checking')
    expect(onClose).toHaveBeenCalled()
    onClose.mockClear()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    view.rerender(<QuestDeferMenu menu={null} onDefer={onDefer} onClose={onClose} />)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('adds «Редактировать точку» for the owner\'s point', () => {
    const onEdit = vi.fn()
    render(<QuestDeferMenu menu={{ questId: 'checking', title: 'Проверка', x: 40, y: 50, onEdit }} onDefer={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Редактировать точку' }))
    expect(onEdit).toHaveBeenCalled()
  })
})

describe('«Отложенные квесты»: the window', () => {
  it('lists each quest with one square picture of what it needs in the raid, «+N» for the others, and returns the ticked ones', () => {
    const onRestore = vi.fn()
    render(<DeferredQuestsDialog rows={rows} onRestore={onRestore} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Отложенные квесты' })
    const checking = within(dialog).getByRole('checkbox', { name: /Проверка/ }).closest('label')!
    expect(checking).toHaveTextContent('Прапор · Таможня')
    expect(within(checking).getByText('Ключ от спецтехники')).toBeInTheDocument()
    expect(checking.querySelector('.deferred-item-picture img')).toHaveAttribute('src', 'https://assets.example/machinery.webp')
    expect(within(checking).getByText('+2')).toHaveClass('deferred-item-more')
    expect(checking.querySelectorAll('img')).toHaveLength(1)
    const aquarius = within(dialog).getByRole('checkbox', { name: /Водолей/ }).closest('label')!
    expect(within(aquarius).getByText('Ключ от комнаты 206')).toBeInTheDocument()
    expect(aquarius.querySelector('.deferred-item-more')).toBeNull()
    expect(within(dialog).getByRole('checkbox', { name: /Дебют/ }).closest('label')).toHaveTextContent('Ничего брать не нужно')

    const restore = within(dialog).getByRole('button', { name: 'Вернуть' })
    expect(restore).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Водолей/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Дебют/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вернуть (2)' }))
    expect(onRestore).toHaveBeenCalledWith(['aquarius', 'debut'])
  })

  it('«Выбрать все» ticks every quest; Escape and «Отмена» close it', () => {
    const onRestore = vi.fn()
    const onClose = vi.fn()
    render(<DeferredQuestsDialog rows={rows} onRestore={onRestore} onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать все' }))
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть (3)' }))
    expect(onRestore).toHaveBeenCalledWith(['checking', 'aquarius', 'debut'])
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('explains the right click when nothing is put aside', () => {
    render(<DeferredQuestsDialog rows={[]} onRestore={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('Нажмите правой кнопкой мыши на квест')
    expect(screen.queryByRole('button', { name: /Вернуть/ })).toBeNull()
  })
})
