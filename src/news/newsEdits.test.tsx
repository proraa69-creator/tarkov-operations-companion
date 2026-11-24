import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { NewsButton } from './NewsButton'
import { applyNewsEdits, parseNewsEdits, reloadNewsEditsForTests, setNewsEdits } from './newsEdits'
import { NEWS, type NewsEntry } from './newsState'

const list: NewsEntry[] = [
  { version: '2', date: '2026-11-06', items: [{ kind: 'added', ru: 'Своё', en: 'Own' }] },
  { version: '1', date: '2026-11-05', items: [{ kind: 'improved', ru: 'Старое', en: 'Old' }] },
]

beforeEach(() => { localStorage.clear(); reloadNewsEditsForTests() })
afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop'); localStorage.clear(); reloadNewsEditsForTests() })

describe('«Обновление» for the players', () => {
  it('the owner\'s lines stand over the app\'s, a release emptied is not listed, one this app does not know is left out', () => {
    const edits = { 2: [{ kind: 'changed' as const, ru: 'Новое', en: '' }], 1: [], 9: [{ kind: 'added' as const, ru: 'Чужое', en: '' }] }
    expect(applyNewsEdits(list, edits).map((entry) => [entry.version, entry.items.map((item) => item.ru)])).toEqual([['2', ['Новое']]])
  })

  it('reads the server\'s answer strictly', () => {
    expect(parseNewsEdits(null)).toBeNull()
    expect(parseNewsEdits({ edits: 5 })).toBeNull()
    expect(parseNewsEdits({ edits: { 2: [{ kind: 'added', ru: 'Да', en: 'Yes' }, { kind: 'x', ru: 'Нет' }, { kind: 'added', ru: '' }], 1: 'нет' } })).toEqual({ 2: [{ kind: 'added', ru: 'Да', en: 'Yes' }] })
  })

  it('named «Обновление»; opening it asks the server, and the owner\'s text is there at once, Russian where there is no English', async () => {
    const version = NEWS[0]!.version
    const request = vi.fn(async () => ({ edits: { [version]: [{ kind: 'changed', ru: 'Текст владельца', en: '' }] } }))
    Object.assign(window, { tarkovDesktop: { serviceRequest: request } })
    render(<LocaleProvider><NewsButton /></LocaleProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^Обновление/ }))
    const dialog = screen.getByRole('dialog', { name: 'Обновление' })
    expect(await within(dialog).findByText('Текст владельца')).toBeInTheDocument()
    expect((request.mock.calls as unknown[][]).some((call) => call.includes('/v1/player-news'))).toBe(true)
    expect(within(dialog).getAllByText(version)).toHaveLength(1)
  })

  it('a saved edit shows in an open window without closing it, and stays for a start without network', async () => {
    Object.assign(window, { tarkovDesktop: { serviceRequest: vi.fn(async () => ({ edits: {} })) } })
    render(<LocaleProvider><NewsButton /></LocaleProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^Обновление/ }))
    await waitFor(() => expect(window.tarkovDesktop!.serviceRequest).toHaveBeenCalled())
    const version = NEWS[0]!.version
    setNewsEdits({ [version]: [{ kind: 'added', ru: 'Прямо сейчас', en: 'Right now' }] })
    expect(await screen.findByText('Прямо сейчас')).toBeInTheDocument()
    reloadNewsEditsForTests()
    expect(applyNewsEdits(NEWS, parseNewsEdits({ edits: JSON.parse(localStorage.getItem('raidos-news-edits-v1')!) })!)[0]!.items[0]!.ru).toBe('Прямо сейчас')
  })

  // Without a line in these lists the app itself refuses: «Неизвестный запрос сервиса».
  it.each(['electron/serviceGateway.ts', 'src/sync/webAccount.ts'])('%s knows its addresses', (path) => {
    const routes = readFileSync(path, 'utf8')
    expect(routes).toContain('/^\\/v1\\/player-news$/')
    expect(routes).toContain('admin\\/player-news$/')
    expect(routes).toContain('admin\\/player-news\\/reset$/')
  })
})
