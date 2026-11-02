import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, NavLink } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewFeaturesTip, NEW_FEATURES_TIP_KEY } from './NewFeaturesTip'
import { GUIDE_TIMING } from './guideProgress'

/** The PC Overview with the menu. */
const open = (path = '/') => render(<MemoryRouter initialEntries={[path]}><NewFeaturesTip />
  <nav className="sidebar"><NavLink className="nav-link" to="/quests">Квесты</NavLink><NavLink className="nav-link" to="/maps">Карты</NavLink></nav>
</MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })
const desktopWidth = window.innerWidth

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(Date.UTC(2026, 10, 3, 12))
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); Object.assign(window, { innerWidth: desktopWidth }) })

describe('pointers at the new sections', () => {
  it('points at «Карты» about «Отложенные квесты» in the owner\'s words once per device, also where the first words were seen (owner, 03.11.2026)', async () => {
    localStorage.setItem('raidos-new-features-0-6-0-192-v1', '2026-11-03T19:50:00.000Z')
    const view = open()
    await settle()
    const tip = screen.getByRole('dialog', { name: 'Новое: отложенные квесты' })
    expect(tip).toHaveTextContent('Нет ключа или нужного предмета для выполнения квеста? Можете временно убрать квест, чтобы он не мешал в общем списке')
    expect(tip).not.toHaveTextContent('правой кнопкой')
    expect(localStorage.getItem(NEW_FEATURES_TIP_KEY)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says nothing on the phone (no right click there)', async () => {
    Object.assign(window, { innerWidth: 390 })
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
