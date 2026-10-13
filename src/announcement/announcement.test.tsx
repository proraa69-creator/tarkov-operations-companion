import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CHECK_MIN_MS, CHECK_SPREAD_MS, followAnnouncement, parseAnnouncement, setAnnouncement } from './announcement'
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
