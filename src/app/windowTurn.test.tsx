import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, NavLink } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoonsRestTip } from '../onboarding/GoonsRestTip'
import { UnneededItemsTip } from '../onboarding/UnneededItemsTip'
import { GUIDE_TIMING } from '../onboarding/guideProgress'
import { releaseWindowTurn, requestWindowTurn, windowTurnHolder } from './windowTurn'

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

// Owner, 03.11.2026: «почему все окна одновременно, нужно что бы они открывались по очереди, не должно быть такого что бы
// одно перекрывало другое».
describe('one window at a time', () => {
  it('the turn goes to the first in line, then to the next in the order they asked', () => {
    requestWindowTurn('a')
    requestWindowTurn('b')
    requestWindowTurn('c')
    requestWindowTurn('b')
    expect(windowTurnHolder()).toBe('a')
    // One that gives up before its turn leaves the line.
    releaseWindowTurn('b')
    releaseWindowTurn('a')
    expect(windowTurnHolder()).toBe('c')
    releaseWindowTurn('c')
    expect(windowTurnHolder()).toBeNull()
  })

  it('two tips due at the same moment open one after the other, never together', async () => {
    render(<MemoryRouter initialEntries={['/']}>
      <GoonsRestTip />
      <UnneededItemsTip />
      <div className="stat-card quest-conditions-card is-empty">Сбор на рейд</div>
      <nav className="sidebar"><NavLink className="nav-link" to="/hideout">Убежище и квесты</NavLink></nav>
    </MemoryRouter>)
    await settle()
    await settle()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Кочевники' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Новое: ненужные предметы из схрона' })).toBeInTheDocument()
    expect(windowTurnHolder()).toBe('unneeded-items')
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(windowTurnHolder()).toBeNull()
  })
})
