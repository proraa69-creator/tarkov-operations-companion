import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, NavLink } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewFeaturesTip, NEW_FEATURES_TIP_KEY } from './NewFeaturesTip'
import { GUIDE_TIMING } from './guideProgress'

vi.mock('../app/archivedFeatures', () => ({ featureEnabled: () => true }))

/** The PC Overview with the menu entries of the new sections. */
const open = () => render(<MemoryRouter initialEntries={['/']}><NewFeaturesTip />
  <nav className="sidebar"><NavLink className="nav-link" to="/arsenal/builds">Сборка оружия</NavLink><NavLink className="nav-link" to="/hideout">Убежище</NavLink></nav>
</MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

describe('pointers at the new sections (owner, 18.10.2026)', () => {
  it('points at «Сборка оружия», then «Убежище», once per device', async () => {
    const view = open()
    await settle()
    expect(screen.getByRole('dialog', { name: 'Новое: сборка оружия' })).toHaveTextContent('Скоро появятся готовые топ-сборки.')
    expect(localStorage.getItem(NEW_FEATURES_TIP_KEY)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.getByRole('dialog', { name: 'Новое: убежище' })).toHaveTextContent('Скоро будет добавлена интерактивная модель убежища.')
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
