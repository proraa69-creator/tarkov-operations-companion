import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { NewsButton } from './NewsButton'
import { applyNewsEdits, parseNewsEdits, reloadNewsEditsForTests, setNewsEdits } from './newsEdits'
import { NEWS, newsText, type NewsEntry } from './newsState'

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

  it('every line in the player\'s language: the owner\'s line with our Russian takes our translations, a new one reads English, then Russian', () => {
    const ours: NewsEntry[] = [{ version: '2', date: '2026-11-06', items: [{ kind: 'added', ru: 'Своё', en: 'Own', es: 'Propio', de: 'Eigenes' }] }]
    const shown = applyNewsEdits(ours, { 2: [{ kind: 'added', ru: 'Своё', en: '', de: 'Selbst' }, { kind: 'changed', ru: 'Новое', en: 'New' }, { kind: 'changed', ru: 'Только русский', en: '' }] })
    const [kept, fresh, russian] = shown[0]!.items
    expect([newsText(kept!, 'es'), newsText(kept!, 'de'), newsText(kept!, 'en'), newsText(kept!, 'ru')]).toEqual(['Propio', 'Selbst', 'Own', 'Своё'])
    expect([newsText(fresh!, 'es'), newsText(fresh!, 'ko')]).toEqual(['New', 'New'])
    expect(newsText(russian!, 'fr')).toBe('Только русский')
  })

  it('reads the server\'s answer strictly', () => {
    expect(parseNewsEdits(null)).toBeNull()
    expect(parseNewsEdits({ edits: 5 })).toBeNull()
    expect(parseNewsEdits({ edits: { 2: [{ kind: 'added', ru: 'Да', en: 'Yes' }, { kind: 'x', ru: 'Нет' }, { kind: 'added', ru: '' }], 1: 'нет' } })).toEqual({ 2: [{ kind: 'added', ru: 'Да', en: 'Yes' }] })
    expect(parseNewsEdits({ edits: { 2: [{ kind: 'added', ru: 'Да', en: 'Yes', es: 'Sí', xx: 'нет', de: 5 }] } })).toEqual({ 2: [{ kind: 'added', ru: 'Да', en: 'Yes', es: 'Sí' }] })
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

describe('«Обновление» in the player\'s language', () => {
  it('Spanish chosen: the lines and the date in Spanish (owner, 25.11.2026: «под каждый язык должны быть новости»)', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'es')
    render(<LocaleProvider><NewsButton /></LocaleProvider>)
    fireEvent.click(screen.getAllByRole('button')[0]!)
    const dialog = screen.getByRole('dialog')
    const line = NEWS[0]!.items[0]!
    expect(within(dialog).getByText(line.es!)).toBeInTheDocument()
    expect(within(dialog).queryByText(line.ru)).toBeNull()
  })
})
