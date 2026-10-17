import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoonsRestTip, GOONS_REST_TIP_KEY } from './GoonsRestTip'
import { GUIDE_TIMING } from './guideProgress'

/** The Overview with «Сбор на рейд» empty (the Goons sit in it) or with a quest. */
const open = (empty = true) => render(<MemoryRouter initialEntries={['/']}><GoonsRestTip />
  <div className={`stat-card quest-conditions-card${empty ? ' is-empty' : ''}`}>Сбор на рейд</div>
</MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

describe('the Goons in the empty «Сбор на рейд» (owner, 16.10.2026)', () => {
  it('points once at that block alone, in the Goons\' words, and never again', async () => {
    const view = open()
    await settle()
    const dialog = screen.getByRole('dialog', { name: 'Кочевники' })
    expect(dialog).toHaveTextContent('У тебя тут квестов нету, мы посидим пока.')
    expect(document.querySelector('.frg-layer[data-step="goons-rest"]')).not.toBeNull()
    expect(localStorage.getItem(GOONS_REST_TIP_KEY)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('waits while the block has quests (no Goons in it)', async () => {
    open(false)
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(GOONS_REST_TIP_KEY)).toBeNull()
  })
})
