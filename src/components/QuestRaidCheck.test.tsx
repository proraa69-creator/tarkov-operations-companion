import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setRenderLanguage } from '../i18n/renderText'
import { exactUiText } from '../i18n/uiEnglish'
import { orderByChecks, readQuestChecks, toggleQuestCheck, useQuestChecks } from '../progression/questChecks'
import { QuestRaidCheck, QuestRaidChecksNote } from './QuestRaidCheck'

const quests = [{ id: 'q-intro', name: 'Ознакомление' }, { id: 'q-data', name: 'Сбор данных' }, { id: 'q-carrier', name: 'Перевозчик' }]

/** The rows of «Квесты на карте» in short: the quest, then its check; checked quests go last. */
function QuestList() {
  const checks = useQuestChecks('p-list', 'pvp')
  return (
    <ul>
      {orderByChecks(quests.map((quest) => ({ quest })), checks).map(({ quest }) => (
        <li key={quest.id}>
          <span>{quest.name}</span>
          <QuestRaidCheck questName={quest.name} checked={checks.has(quest.id)} onToggle={() => toggleQuestCheck('p-list', 'pvp', quest.id)} />
        </li>
      ))}
    </ul>
  )
}

const rowNames = () => screen.getAllByRole('listitem').map((row) => row.textContent)
const storedKeys = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))

/**
 * A browser drops the focus inside a node that is moved (taken out, then put back); jsdom keeps it. With this the test
 * shows that the focus still comes back to the moved check (React restores it after the commit).
 */
function dropFocusWhenMoved() {
  const { appendChild, insertBefore } = Node.prototype
  const blurInside = (node: Node) => {
    const active = document.activeElement
    if (node.isConnected && active instanceof HTMLElement && node.contains(active)) active.blur()
  }
  vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function (this: Node, node: Node) {
    blurInside(node)
    return appendChild.call(this, node)
  } as typeof appendChild)
  vi.spyOn(Node.prototype, 'insertBefore').mockImplementation(function (this: Node, node: Node, child: Node | null) {
    blurInside(node)
    return insertBefore.call(this, node, child)
  } as typeof insertBefore)
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  setRenderLanguage('ru')
})

describe('QuestRaidCheck', () => {
  it('is a toggle button of its own, named after the quest', async () => {
    const onToggle = vi.fn()
    render(<QuestRaidCheck questName="Ознакомление" checked={false} onToggle={onToggle} />)
    const button = screen.getByRole('button', { name: 'Сделал в этом рейде: Ознакомление' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveAttribute('title', 'Сделал в этом рейде')
    await userEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('checks a quest as a note only, moves it to the end and keeps the keyboard on it', async () => {
    const user = userEvent.setup()
    render(<QuestList />)
    dropFocusWhenMoved()
    const intro = screen.getByRole('button', { name: 'Сделал в этом рейде: Ознакомление' })
    intro.focus()
    await user.keyboard('{Enter}')
    expect(intro).toHaveAttribute('aria-pressed', 'true')
    expect(intro).toHaveAttribute('title', 'Снять галочку')
    expect(rowNames()).toEqual(['Сбор данных', 'Перевозчик', 'Ознакомление'])
    expect(intro).toHaveFocus()
    expect([...readQuestChecks('p-list', 'pvp').keys()]).toEqual(['q-intro'])
    // Nothing but the note is written: no profile, no quest progress.
    expect(storedKeys()).toEqual(['tarkov-quest-checks-v1:p-list:pvp'])

    await user.keyboard(' ')
    expect(intro).toHaveAttribute('aria-pressed', 'false')
    expect(rowNames()).toEqual(['Ознакомление', 'Сбор данных', 'Перевозчик'])
    expect(intro).toHaveFocus()
    expect(storedKeys()).toEqual([])
  })
})

describe('QuestRaidChecksNote', () => {
  it('says when the checks go and clears them on request', async () => {
    const onClear = vi.fn()
    const { rerender } = render(<QuestRaidChecksNote autoReset onClear={onClear} />)
    expect(screen.getByText('Галочки сбрасываются при входе в следующий рейд')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Снять все галочки' }))
    expect(onClear).toHaveBeenCalledOnce()
    // Phone and browser: no raid signal, the checks stay.
    rerender(<QuestRaidChecksNote autoReset={false} onClear={onClear} />)
    expect(screen.getByText('Галочки остаются, пока вы их не снимете')).toBeInTheDocument()
  })
})

describe('English for the in-raid checks', () => {
  it('has every phrase as an exact translation', () => {
    const phrases: Array<[string, string]> = [
      ['Сделал в этом рейде', 'Done this raid'],
      ['Снять галочку', 'Clear check'],
      ['Снять все галочки', 'Clear all checks'],
      ['Галочки сбрасываются при входе в следующий рейд', 'Checks clear when the next raid starts'],
      ['Галочки остаются, пока вы их не снимете', 'Checks stay until you clear them'],
    ]
    for (const [ru, en] of phrases) expect(exactUiText(ru), ru).toBe(en)
  })

  it('renders the button and the note in English', () => {
    setRenderLanguage('en')
    render(<><QuestRaidCheck questName="Gunsmith - Part 1" checked onToggle={() => {}} /><QuestRaidChecksNote autoReset={false} onClear={() => {}} /></>)
    expect(screen.getByRole('button', { name: 'Done this raid: Gunsmith - Part 1' })).toHaveAttribute('title', 'Clear check')
    expect(screen.getByText('Checks stay until you clear them')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear all checks' })).toBeInTheDocument()
  })
})
