import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalProfile } from '../domain/progress'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { rememberLastRaid } from '../overview/infoCardClock'
import { addDocumentsFound, readDocumentDay } from '../progression/documentDailyLimit'
import { ASK_WITHIN_MS, readDocumentsAfterRaid, setDocumentsAfterRaid, takeRaidToAsk } from '../progression/documentsAfterRaid'
import { AppStateProvider } from '../state/AppState'
import { DocumentsAfterRaidSetting, RaidDocumentsPrompt } from './RaidDocumentsPrompt'

function renderPrompt() {
  const profile = createLocalProfile('TEST', 'documents')
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  render(<LocaleProvider><AppStateProvider><RaidDocumentsPrompt /></AppStateProvider></LocaleProvider>)
  return profile.id
}
const raidOver = (ended = Date.now()) => act(() => rememberLastRaid({ location: 'bigmap', began: ended - 20 * 60_000, ended }))

beforeEach(() => { localStorage.clear() })
afterEach(() => { localStorage.clear(); delete window.tarkovDesktop })

// Owner, 27.11.2026: «по окончанию рейда вылезает окно и предлагает добавить документы, сколько их. Сколько вынес за рейд, столько и
// добавляешь. И можно включить, чтобы эта функция появлялась и чтобы она не появлялась в настройках карты».
describe('the window after a raid', () => {
  it('asks how many battle pass documents the raid brought out and adds them to today', () => {
    const id = renderPrompt()
    expect(screen.queryByRole('dialog')).toBeNull()
    raidOver()
    const dialog = screen.getByRole('dialog', { name: 'Документы за рейд' })
    expect(dialog).toHaveTextContent('Сколько документов вынесли?')
    const add = screen.getByRole('button', { name: 'Добавить' })
    expect(add).toBeDisabled()
    const more = screen.getByRole('button', { name: 'Документом больше' })
    fireEvent.click(more)
    fireEvent.click(more)
    fireEvent.click(more)
    fireEvent.click(screen.getByRole('button', { name: 'Документом меньше' }))
    expect(dialog).toHaveTextContent('Найдено сегодня: 2 из 25')
    fireEvent.click(add)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readDocumentDay(id).count).toBe(2)
  })

  it('«Пропустить» adds nothing; the next raid asks again', () => {
    const id = renderPrompt()
    const ended = Date.now()
    raidOver(ended)
    fireEvent.click(screen.getByRole('button', { name: 'Документом больше' }))
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readDocumentDay(id).count).toBe(0)
    raidOver(ended + 25 * 60_000)
    expect(screen.getByRole('dialog', { name: 'Документы за рейд' })).toBeInTheDocument()
  })

  it('asks once per raid and only soon after it', () => {
    const ended = Date.now()
    expect(takeRaidToAsk(ended)).toBe(true)
    expect(takeRaidToAsk(ended)).toBe(false)
    expect(takeRaidToAsk(ended + 60_000)).toBe(true)
    expect(takeRaidToAsk(ended + 2 * 60_000, ended + 2 * 60_000 + ASK_WITHIN_MS + 1)).toBe(false)
  })

  it('does not ask with «Спрашивать после рейда» off, nor once the limit of the day is reached', () => {
    const id = renderPrompt()
    act(() => setDocumentsAfterRaid(false))
    raidOver(Date.now() + 1)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => { addDocumentsFound(id, 25); setDocumentsAfterRaid(true) })
    raidOver(Date.now() + 2)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the switch in «Настройки карты»: on until turned off, on the PC only', () => {
    const { container, rerender } = render(<DocumentsAfterRaidSetting />)
    expect(container).toBeEmptyDOMElement()
    window.tarkovDesktop = {} as NonNullable<Window['tarkovDesktop']>
    rerender(<DocumentsAfterRaidSetting />)
    expect(screen.getByRole('group', { name: 'Документы боевого пропуска' })).toBeInTheDocument()
    const toggle = () => screen.getByRole('switch', { name: 'Спрашивать после рейда' })
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle())
    expect(readDocumentsAfterRaid()).toBe(false)
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
  })
})
