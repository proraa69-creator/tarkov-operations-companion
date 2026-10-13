import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { announcementForLocale, CHECK_MIN_MS, CHECK_SPREAD_MS, followAnnouncement, parseAnnouncement, setAnnouncement } from './announcement'
import { AnnouncementBanner } from './AnnouncementBanner'

describe('the owner\'s notice', () => {
  it('reads the server\'s answer and nothing malformed', () => {
    expect(parseAnnouncement({ version: 7, announcement: { text: ' Технические работы ', updatedAt: '2026-10-13T18:00:00.000Z' } })).toEqual({ version: 7, announcement: { text: 'Технические работы', updatedAt: '2026-10-13T18:00:00.000Z' } })
    expect(parseAnnouncement({ version: 8, announcement: null })).toEqual({ version: 8, announcement: null })
    expect(parseAnnouncement({ version: 9, announcement: { text: '   ' } })).toEqual({ version: 9, announcement: null })
    expect(parseAnnouncement(null)).toBeNull()
  })

  it('shows at the top while it is on and goes when the owner turns it off', () => {
    render(<AnnouncementBanner />)
    expect(screen.queryByRole('status')).toBeNull()
    act(() => setAnnouncement({ text: 'Ведутся технические работы', updatedAt: '2026-10-13T18:00:00.000Z' }))
    expect(screen.getByRole('status').textContent).toBe('Ведутся технические работы')
    act(() => setAnnouncement(null))
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('the notice in the reader\'s language', () => {
  const ru = 'Уважаемые друзья! Мы запустились недавно, если возникают какие то проблемы, мы их оперативно вычисляем и устраняем. Благодарим за понимание и доверие 🤝'
  const en = 'Dear friends! We launched recently; if any issues arise, we identify and resolve them promptly. Thank you for your understanding and trust 🤝'

  it('shows only the Russian or the English half of a notice written in both', () => {
    expect(announcementForLocale(`${ru}\n\n${en}`, 'ru')).toBe(ru)
    expect(announcementForLocale(`${ru}\n\n${en}`, 'en')).toBe(en)
    expect(announcementForLocale(`${en}\n \n\n${ru}`, 'ru')).toBe(ru)
  })

  it('keeps a notice in one language, its line breaks and paragraphs in neither alphabet', () => {
    expect(announcementForLocale('Технические работы до 18:00 по Raid OS', 'en')).toBe('Технические работы до 18:00 по Raid OS')
    expect(announcementForLocale('Работы\nв 2 этапа', 'en')).toBe('Работы\nв 2 этапа')
    expect(announcementForLocale(`${ru}\n\n18:00 — 19:00 🤝\n\n${en}`, 'en')).toBe(`18:00 — 19:00 🤝\n\n${en}`)
  })

  it('renders the English half in the English interface', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    render(<LocaleProvider><AnnouncementBanner /></LocaleProvider>)
    act(() => setAnnouncement({ text: `${ru}\n\n${en}`, updatedAt: '2026-10-13T21:29:13.856Z' }))
    expect(screen.getByRole('status').textContent).toBe(en)
    act(() => setAnnouncement(null))
    localStorage.removeItem('tarkov-operations-locale-v1')
  })
})

describe('checking for the notice', () => {
  it('asks once now and then once every 3–6 minutes, at a random moment, offline included', async () => {
    const answers: unknown[] = [{ version: 1, announcement: { text: 'Работы', updatedAt: '' } }, null]
    const asked: string[] = []
    const sleep = vi.fn(async (ms: number) => ms)
    const random = vi.fn(() => 0.5).mockReturnValueOnce(0).mockReturnValueOnce(0.999)
    await followAnnouncement(async (path) => { asked.push(path); return answers.shift() }, sleep, 3, random)
    expect(asked).toEqual(['/v1/announcement', '/v1/announcement', '/v1/announcement'])
    const pauses = sleep.mock.calls.map(([ms]) => ms)
    expect(pauses[0]).toBe(CHECK_MIN_MS)
    expect(pauses[1]).toBeGreaterThan(CHECK_MIN_MS + CHECK_SPREAD_MS - 1000)
    expect(pauses.every((ms) => ms >= CHECK_MIN_MS && ms < CHECK_MIN_MS + CHECK_SPREAD_MS)).toBe(true)
    setAnnouncement(null)
  })
})
