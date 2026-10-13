import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseAnnouncement, setAnnouncement } from './announcement'
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
