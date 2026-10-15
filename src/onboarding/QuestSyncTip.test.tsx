import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../sync/serverSync', () => ({ useServerStatus: () => null }))
const { QuestSyncTip } = await import('./QuestSyncTip')
const { GUIDE_TIMING, QUEST_SYNC_TIP_KEY, questSyncTipDue } = await import('./guideProgress')

const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><QuestSyncTip /><div data-block="tasks">Список текущих заданий</div></MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(400) })

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
  Object.assign(window, { tarkovDesktop: {} })
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); Reflect.deleteProperty(window, 'tarkovDesktop') })

describe('quest sync tip', () => {
  it('is for the Overview of the PC app, until accepted on this computer', () => {
    const due = { desktop: true, phone: false, pathname: '/', seen: false }
    expect(questSyncTipDue(due)).toBe(true)
    expect(questSyncTipDue({ ...due, desktop: false })).toBe(false)
    expect(questSyncTipDue({ ...due, phone: true })).toBe(false)
    expect(questSyncTipDue({ ...due, pathname: '/quests' })).toBe(false)
    expect(questSyncTipDue({ ...due, seen: true })).toBe(false)
  })

  it('is not due when the logs of the mode shown hold every quest (owner, 14.10.2026)', () => {
    const due = { desktop: true, phone: false, pathname: '/', seen: false }
    expect(questSyncTipDue({ ...due, logsCover: true })).toBe(false)
    expect(questSyncTipDue({ ...due, logsCover: false })).toBe(true)
  })

  it('asks PvE players only: in PvP and Season the Tasks table is never read (owner, 15.10.2026)', () => {
    const due = { desktop: true, phone: false, pathname: '/', seen: false }
    expect(questSyncTipDue({ ...due, mode: 'pve' })).toBe(true)
    expect(questSyncTipDue({ ...due, mode: 'pvp' })).toBe(false)
    expect(questSyncTipDue({ ...due, mode: 'seasonal' })).toBe(false)
  })

  it('shows once on the Overview, in plain words, and stays away after «Принял»', async () => {
    const view = open('/')
    await settle()
    const dialog = screen.getByRole('dialog', { name: 'Полная синхронизация квестов' })
    expect(dialog).toHaveTextContent('откройте «Персонаж» → «Задания» и не спеша пролистайте список до конца')
    expect(dialog).not.toHaveTextContent(/лог|журнал|экран/i)
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(QUEST_SYNC_TIP_KEY)).not.toBeNull()
    view.unmount()
    open('/')
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says nothing on other pages or outside the PC app', async () => {
    const view = open('/maps')
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.unmount()
    Reflect.deleteProperty(window, 'tarkovDesktop')
    open('/')
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
