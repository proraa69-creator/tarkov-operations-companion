import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameRestartNotice } from './GameRestartNotice'
import { GAME_START_LIMIT, noteGameSighting, noteModeSelectRead } from './gameStarts'
import { setRenderLanguage } from '../i18n/renderText'

const reading = vi.hoisted(() => ({ value: null as null | { at: number; nickname: string | null; cards: Array<{ mode: 'pvp' | 'pve' | 'seasonal'; nickname?: string; level?: number }> } }))
vi.mock('../account/logNickname', () => ({ useScreenReading: () => reading.value }))

describe('the first-launch notice', () => {
  it('says the order of the starts and that there is nothing to worry about (owner, 07.11.2026)', async () => {
    vi.useFakeTimers()
    localStorage.clear()
    reading.value = null
    vi.stubGlobal('tarkovDesktop', {})
    render(<GameRestartNotice />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text).toContain('Закройте игру, если она открыта.')
    expect(text).toContain('только потом запустите игру')
    expect(text).toContain('логин и уровень')
    expect(text).toContain('не использует её память и не внедряется в неё')
    vi.useRealTimers()
    vi.unstubAllGlobals()
    cleanup()
  })

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
    expect(screen.getByRole('dialog').textContent).toMatch(/Сначала Raid OS, потом игра/)
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

  it('the one-time way out reads in English too (owner, 04.11.2026: the table is read at the first sync)', async () => {
    setRenderLanguage('en')
    try {
      render(<GameRestartNotice />)
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(screen.getByRole('dialog').textContent).toMatch(/Once, open Character → Tasks in the game and scroll through the whole list: the quests add themselves\. Or add them with «Add manually»\. After that everything updates from the logs\./)
    } finally {
      setRenderLanguage('ru')
    }
  })

  it('shown once per computer: the next start (an update, a restart before «Понятно») has none (owner, 16.10.2026)', async () => {
    const { unmount } = render(<GameRestartNotice />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.getByRole('dialog').textContent).toMatch(/Сначала Raid OS, потом игра/)
    // What the logs cannot do, and the one-time way out (owner, 03.11.2026).
    expect(screen.getByRole('dialog').textContent).toMatch(/игра сама удаляет старые логи, поэтому часть квестов может не найтись — обойти это нельзя/)
    expect(screen.getByRole('dialog').textContent).toMatch(/откройте в игре «Персонаж» → «Задания» и пролистайте весь список, квесты добавятся сами, или добавьте их через «Ручное добавление»\. Дальше всё обновляется по логам\./)
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
    expect(screen.queryByText(/Сначала Raid OS, потом игра/)).toBeNull()
    other.remove()
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(screen.getByText(/Сначала Raid OS, потом игра/)).toBeTruthy()
  })

  it('is not shown outside the desktop app', async () => {
    vi.unstubAllGlobals()
    render(<GameRestartNotice />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
