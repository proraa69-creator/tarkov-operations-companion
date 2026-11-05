import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeatureTours } from '../onboarding/FeatureTours'
import { TOURS_KEY } from '../onboarding/tours'
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

  it('a tip waits while another window holds the turn, then the tour goes on step after step', async () => {
    localStorage.setItem(TOURS_KEY, JSON.stringify({ choice: 'yes', since: '0', seen: [] }))
    requestWindowTurn('announcement')
    render(<MemoryRouter initialEntries={['/hideout']}>
      <FeatureTours />
      <main className="content"><div className="page"><div className="hideout-hub-choices"><a className="hideout-hub-choice" href="/hideout/stash">Схрон</a></div></div></main>
    </MemoryRouter>)
    await settle()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => releaseWindowTurn('announcement'))
    await settle()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Убежище и квесты' })).toBeInTheDocument()
    expect(windowTurnHolder()).toBe('feature-tours')
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(windowTurnHolder()).toBeNull()
  })
})
