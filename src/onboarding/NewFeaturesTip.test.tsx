import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, NavLink } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewFeaturesTip, NEW_FEATURES_TIP_KEY } from './NewFeaturesTip'
import { GUIDE_TIMING } from './guideProgress'

/** The PC Overview with the menu and the Overview's Halloween button. */
const open = (path = '/') => render(<MemoryRouter initialEntries={[path]}><NewFeaturesTip />
  <nav className="sidebar"><NavLink className="nav-link" to="/flea">Барахолка</NavLink><NavLink className="nav-link" to="/tier-lists">Тир листы</NavLink></nav>
  <button type="button" className="halloween-event-button">Хеллоуин</button>
</MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(Date.UTC(2026, 10, 2, 12))
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

describe('pointers at the new sections', () => {
  it('points at the Halloween button once per device, also where the «Тир листы» pointer was seen (owner, 02.11.2026)', async () => {
    localStorage.setItem('raidos-new-features-0-6-0-176-v1', '2026-11-02T08:00:00.000Z')
    const view = open()
    await settle()
    expect(screen.getByRole('dialog', { name: 'Новое: ивент Хеллоуин' })).toHaveTextContent('развилка Лыжника и Терапевта')
    expect(localStorage.getItem(NEW_FEATURES_TIP_KEY)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says nothing about the event once it is over', async () => {
    vi.setSystemTime(Date.UTC(2026, 10, 12, 7))
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('waits for the Overview', async () => {
    open('/quests')
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(NEW_FEATURES_TIP_KEY)).toBeNull()
  })
})
