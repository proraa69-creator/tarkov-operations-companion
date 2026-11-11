import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuestSheetObjectives } from './QuestSheetObjectives'
import { QuestSheetViewButton } from './QuestSheetViewButton'
import { setQuestSheetView, useQuestSheetView } from './questSheetView'
import type { SheetObjectives } from '../progression/sheetObjectives'

vi.mock('./QuestSheetEditing', () => ({ EditableText: ({ children, value }: { children?: React.ReactNode; value: string }) => <>{children ?? value}</> }))

const sheet: SheetObjectives = {
  showWhere: false,
  groups: [
    { kind: 'raid', title: 'В рейде', objectives: [{ id: 'plant', text: 'Заложить зажигалку', where: null, here: false, done: true }, { id: 'find', text: 'Найти золотую зажигалку', where: null, here: false, done: false }] },
    { kind: 'handover', title: 'Сдать торговцу', objectives: [{ id: 'hand', text: 'Передать найденный предмет', where: null, here: false, done: false }] },
  ],
}

afterEach(() => { cleanup(); act(() => setQuestSheetView('classic')) })

describe('the quest window\'s looks (owner, 11.11.2026: «добавь 2 3 вариант и функцию смены вида»)', () => {
  it('«Вкладки по этапам»: one stage at a time, each tab with its count', () => {
    render(<QuestSheetObjectives sheet={sheet} trader="Лыжник" view="tabs" />)
    const tabs = screen.getByRole('tablist', { name: 'Этапы' })
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['В рейде1/2', 'Торговцу0/1'])
    expect(screen.getByText('Найти золотую зажигалку')).toBeInTheDocument()
    expect(screen.queryByText('Передать найденный предмет')).toBeNull()
    fireEvent.click(within(tabs).getByRole('tab', { name: /Торговцу/ }))
    expect(screen.getByText('Передать найденный предмет')).toBeInTheDocument()
    expect(screen.queryByText('Найти золотую зажигалку')).toBeNull()
  })

  it('«Шкала этапов»: the stages as steps with what is done, «Готово» at the end, every stage shown', () => {
    render(<QuestSheetObjectives sheet={sheet} trader="Лыжник" view="timeline" />)
    const steps = screen.getByRole('list', { name: 'Этапы' })
    expect(steps).toHaveTextContent(/1\/2В рейде.*0\/1Торговцу.*Готово1\/3/)
    expect(screen.getByText('Найти золотую зажигалку')).toBeInTheDocument()
    expect(screen.getByText('Передать найденный предмет')).toBeInTheDocument()
  })

  it('the gear switches the look and keeps it on this device', () => {
    function Look() { return <output>{useQuestSheetView()}</output> }
    render(<><QuestSheetViewButton /><Look /></>)
    expect(screen.getByRole('status')).toHaveTextContent('classic')
    fireEvent.click(screen.getByRole('button', { name: 'Вид окна' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Шкала этапов' }))
    expect(screen.getByRole('status')).toHaveTextContent('timeline')
    expect(localStorage.getItem('raidos-quest-sheet-view-v1')).toBe('timeline')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
