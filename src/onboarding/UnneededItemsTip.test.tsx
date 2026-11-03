import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, NavLink, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnneededItemsTip, UNNEEDED_TIP_KEY } from './UnneededItemsTip'
import { GUIDE_TIMING } from './guideProgress'

/** The PC Overview with «Убежище и квесты» in the menu. */
const open = () => render(<MemoryRouter initialEntries={['/']}>
  <UnneededItemsTip />
  <nav className="sidebar"><NavLink className="nav-link" to="/hideout">Убежище и квесты</NavLink></nav>
  <Routes><Route path="/" element={<p>Обзор</p>} /><Route path="/hideout" element={<p>Раздел убежища</p>} /></Routes>
</MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

// Owner, 31.10.2026: «добавь уведомление при запуске, что теперь отображаются предметы из схрона которые больше не требуются
// по квестам и для убежища. для этого нужно сделать синхронизацию в схроне».
describe('the pointer at «Не нужные предметы»', () => {
  it('says what is new and that the stash must be synced, opens the section, once per device', async () => {
    const view = open()
    await settle()
    const tip = screen.getByRole('dialog', { name: 'Новое: ненужные предметы из схрона' })
    expect(tip).toHaveTextContent('больше не требуются ни по квестам, ни для убежища')
    expect(tip).toHaveTextContent('сделайте синхронизацию схрона')
    expect(localStorage.getItem(UNNEEDED_TIP_KEY)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.getByText('Раздел убежища')).toBeInTheDocument()
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
