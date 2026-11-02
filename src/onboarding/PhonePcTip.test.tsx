import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUIDE_TIMING } from './guideProgress'

const env = vi.hoisted(() => ({
  native: true,
  status: { signedIn: true } as null | { signedIn: boolean },
  quests: {} as Record<string, unknown>,
}))
vi.mock('../platform', async (original) => ({ ...(await original<typeof import('../platform')>()), isNative: () => env.native }))
vi.mock('../sync/serverSync', () => ({ useServerStatus: () => env.status }))
vi.mock('../state/AppState', () => ({
  useAppState: () => ({ activeProfile: { modes: { pvp: { taskProgress: env.quests }, pve: { taskProgress: {} }, seasonal: { taskProgress: {} } } } }),
}))

const { PhonePcTip, PHONE_PC_TIP_KEY, PHONE_PC_DATA_WAIT_MS } = await import('./PhonePcTip')

const open = () => render(<MemoryRouter initialEntries={['/']}><PhonePcTip /></MemoryRouter>)
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
  Object.assign(env, { native: true, status: { signedIn: true }, quests: {} })
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

// Owner, 03.11.2026: «в приложении для телефонов добавь подсказку, для новых пользователей, что бы данные
// синхронизировались с игрой, нужно установить версию для пк».
describe('the phone tip «install the PC version»', () => {
  it('a new player on the phone, with nothing from a PC, sees it once after the first seconds', async () => {
    const view = open()
    await wait(PHONE_PC_DATA_WAIT_MS - 1000)
    expect(screen.queryByRole('dialog')).toBeNull()
    await wait(1600)
    const tip = screen.getByRole('dialog', { name: 'Синхронизация с игрой' })
    expect(tip).toHaveTextContent('установите Raid OS на компьютер, где вы играете, и войдите в тот же аккаунт: raidos.app/download')
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(PHONE_PC_TIP_KEY)).not.toBeNull()
    view.unmount()
    open()
    await wait(PHONE_PC_DATA_WAIT_MS + 1000)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('not with the PC\'s data, not without a sign-in, not on the PC', async () => {
    env.quests = { quest: { taskId: 'quest', status: 'active', source: 'eft-log', updatedAt: '2026-11-03T10:00:00.000Z' } }
    const withData = open()
    await wait(PHONE_PC_DATA_WAIT_MS + 1000)
    expect(screen.queryByRole('dialog')).toBeNull()
    // The PC's data was there: this phone never needs the tip.
    expect(localStorage.getItem(PHONE_PC_TIP_KEY)).not.toBeNull()
    withData.unmount()
    localStorage.clear()
    env.quests = {}
    env.status = { signedIn: false }
    const signedOut = open()
    await wait(PHONE_PC_DATA_WAIT_MS + 1000)
    expect(screen.queryByRole('dialog')).toBeNull()
    signedOut.unmount()
    env.status = { signedIn: true }
    env.native = false
    open()
    await wait(PHONE_PC_DATA_WAIT_MS + 1000)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
