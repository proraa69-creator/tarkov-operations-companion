import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const NOW = Date.now()
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()
const account = (createdAt: string) => ({ signedIn: true, email: 'new@example.com', online: true, serverUrl: 'https://raidos.app', persistent: true, createdAt })
const mocks = vi.hoisted(() => ({ status: null as unknown, loading: false }))
vi.mock('../sync/serverSync', () => ({ useServerStatus: () => mocks.status }))
vi.mock('../data/DataProvider', () => ({ useOptionalTarkovData: () => ({ data: { quests: [] }, initialLoading: mocks.loading }) }))
const { QuestSyncTip } = await import('./QuestSyncTip')
const { GUIDE_TIMING, QUEST_SYNC_TIP_KEY, questSyncTipDue, readGuide, restartGuide } = await import('./guideProgress')

/** The Overview: the loading screen while the catalog loads, the tasks block after (as app/AppShell.tsx draws them). */
const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><QuestSyncTip />
  {mocks.loading ? <div role="status">Загружаем актуальную базу</div> : <div data-block="tasks">Список текущих заданий</div>}
</MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(400) })
const base = { desktop: true, phone: false, pathname: '/', seen: false, newAccount: true, loading: false }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
  Object.assign(window, { tarkovDesktop: {} })
  mocks.status = account(daysAgo(1))
  mocks.loading = false
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); Reflect.deleteProperty(window, 'tarkovDesktop') })

describe('quest sync tip: when it is due', () => {
  it('is for the Overview of the PC app, a new account, the catalog loaded, until accepted', () => {
    expect(questSyncTipDue(base)).toBe(true)
    expect(questSyncTipDue({ ...base, desktop: false })).toBe(false)
    expect(questSyncTipDue({ ...base, phone: true })).toBe(false)
    expect(questSyncTipDue({ ...base, pathname: '/quests' })).toBe(false)
    expect(questSyncTipDue({ ...base, seen: true })).toBe(false)
    expect(questSyncTipDue({ ...base, newAccount: false }), 'an existing account').toBe(false)
    expect(questSyncTipDue({ ...base, loading: true }), 'over «Загружаем актуальную базу»').toBe(false)
  })

  it('is not due when the logs of the mode shown hold every quest (owner, 14.10.2026)', () => {
    expect(questSyncTipDue({ ...base, logsCover: true })).toBe(false)
    expect(questSyncTipDue({ ...base, logsCover: false })).toBe(true)
  })

  it('asks PvE players only: in PvP and Season the Tasks table is never read (owner, 15.10.2026)', () => {
    expect(questSyncTipDue({ ...base, mode: 'pve' })).toBe(true)
    expect(questSyncTipDue({ ...base, mode: 'pvp' })).toBe(false)
    expect(questSyncTipDue({ ...base, mode: 'seasonal' })).toBe(false)
  })
})

describe('quest sync tip: only once, at a new account\'s first sign-in (owner, 15.10.2026)', () => {
  it('a new account sees it once on the Overview, in plain words; «Принял» is kept in its guide record', async () => {
    const view = open('/')
    await settle()
    const dialog = screen.getByRole('dialog', { name: 'Полная синхронизация квестов' })
    expect(dialog).toHaveTextContent('откройте «Персонаж» → «Задания» и не спеша пролистайте список до конца')
    expect(dialog).not.toHaveTextContent(/лог|журнал|экран/i)
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readGuide('new@example.com')?.accepted).toContain('quest-sync')
    view.unmount()
    open('/')
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape accepts it too, and «Показать снова» of the guide does not bring it back', async () => {
    const view = open('/')
    await settle()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.unmount()
    restartGuide('new@example.com')
    open('/')
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('an existing account never sees it (no guide record, not new) — and nothing is stored for it', async () => {
    mocks.status = { ...account(daysAgo(60)), email: 'old@example.com' }
    open('/')
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readGuide('old@example.com')).toBeNull()
  })

  it('nobody signed in: no tip', async () => {
    mocks.status = null
    open('/')
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('accepted under the old key on this computer: never again, even for a new account', async () => {
    localStorage.setItem(QUEST_SYNC_TIP_KEY, '2026-10-14T10:00:00.000Z')
    open('/')
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('never over the loading screen: it waits until the catalog has loaded and the tasks block is drawn', async () => {
    mocks.loading = true
    const view = open('/')
    await settle()
    await settle()
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем актуальную базу')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    mocks.loading = false
    view.rerender(<MemoryRouter initialEntries={['/']}><QuestSyncTip /><div data-block="tasks">Список текущих заданий</div></MemoryRouter>)
    await settle()
    expect(screen.getByRole('dialog', { name: 'Полная синхронизация квестов' })).toBeInTheDocument()
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
