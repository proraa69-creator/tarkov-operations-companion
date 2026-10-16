import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameRestartNotice } from './GameRestartNotice'
import { GAME_START_LIMIT, noteGameSighting, noteModeSelectRead } from './gameStarts'

const reading = vi.hoisted(() => ({ value: null as null | { at: number; nickname: string | null; cards: Array<{ mode: 'pvp' | 'pve' | 'seasonal'; nickname?: string; level?: number }> } }))
vi.mock('../account/logNickname', () => ({ useScreenReading: () => reading.value }))

describe('the first-launch notice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    reading.value = null
    vi.stubGlobal('tarkovDesktop', {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('asks to restart the game and shows what was read; once it was read, never again', async () => {
    const { rerender, unmount } = render(<GameRestartNotice />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.getByRole('dialog').textContent).toMatch(/Перезапустите Escape from Tarkov/)
    expect(screen.getByRole('status').textContent).toMatch(/Ждём экран выбора режима/)
    reading.value = { at: Date.now(), nickname: 'Raid_OS', cards: [{ mode: 'pve', nickname: 'Raid_OS', level: 41 }, { mode: 'pvp', nickname: 'Raid_OS', level: 12 }] }
    noteModeSelectRead()
    rerender(<GameRestartNotice />)
    expect(screen.getByRole('status').textContent).toMatch(/Raid_OS · PvE 41 · PvP 12/)
    fireEvent.click(screen.getByRole('button', { name: /Понятно/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()
    render(<GameRestartNotice />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shown once per computer: the next start (an update, a restart before «Понятно») has none (owner, 16.10.2026)', async () => {
    const { unmount } = render(<GameRestartNotice />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.getByRole('dialog').textContent).toMatch(/Перезапустите Escape from Tarkov/)
    unmount()
    render(<GameRestartNotice />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stops after three game starts without a reading', async () => {
    for (let start = 1; start <= GAME_START_LIMIT; start += 1) noteGameSighting({ freshGame: true, gameSince: Date.now() + start * 60_000 }, Date.now())
    render(<GameRestartNotice />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a nickname read without a level, and only the levels confirmed', async () => {
    const { rerender } = render(<GameRestartNotice />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    reading.value = { at: Date.now(), nickname: 'Raid_OS', cards: [{ mode: 'pve', nickname: 'Raid_OS' }, { mode: 'pvp', level: 12 }] }
    rerender(<GameRestartNotice />)
    expect(screen.getByRole('status').textContent).toBe('Raid_OS · PvP 12')
  })

  it('waits while another window (sign-in, update) is open', async () => {
    const other = document.createElement('div')
    other.setAttribute('aria-modal', 'true')
    document.body.append(other)
    render(<GameRestartNotice />)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(screen.queryByText(/Перезапустите Escape from Tarkov/)).toBeNull()
    other.remove()
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(screen.getByText(/Перезапустите Escape from Tarkov/)).toBeTruthy()
  })

  it('is not shown outside the desktop app', async () => {
    vi.unstubAllGlobals()
    render(<GameRestartNotice />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
