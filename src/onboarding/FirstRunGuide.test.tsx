import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ status: null as import('../electron').ServerAccountStatus | null }))
vi.mock('../sync/serverSync', () => ({ useServerStatus: () => mocks.status }))
const { FirstRunGuide } = await import('./FirstRunGuide')
const { GUIDE_TIMING, readGuide } = await import('./guideProgress')

const newAccount = { signedIn: true, email: 'new@example.com', online: true, serverUrl: 'https://raidos.app', persistent: true, createdAt: new Date().toISOString() }
const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><FirstRunGuide /></MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(400) })

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
  mocks.status = newAccount
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); document.body.innerHTML = '' })

describe('first-run guide', () => {
  it('shows a section’s tip to a new account once, until «Принял»', async () => {
    const view = open('/quests')
    await settle()
    expect(screen.getByRole('dialog', { name: 'Сюжетные задания' })).toHaveTextContent('Достаточно держать окно открытым 3 секунды')
    expect(screen.getByRole('button', { name: 'Принял' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readGuide('new@example.com')?.accepted).toEqual(['quests'])
    view.unmount()
    open('/quests')
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says nothing to an older account', async () => {
    mocks.status = { ...newAccount, createdAt: '2025-01-01T00:00:00Z' }
    open('/kappa-items')
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.length).toBe(0)
  })

  it('waits while another dialog (update, subscription) is open', async () => {
    const other = document.createElement('div')
    other.setAttribute('aria-modal', 'true')
    document.body.append(other)
    open('/maps')
    await settle()
    expect(screen.queryByRole('dialog', { name: 'Галочка у задания' })).not.toBeInTheDocument()
    other.remove()
    await settle()
    expect(screen.getByRole('dialog', { name: 'Галочка у задания' })).toHaveTextContent('Галочки снимаются сами')
    // Escape is «Принял» too; Tab does not leave the tip.
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Принял' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    await settle()
    expect(readGuide('new@example.com')?.accepted).toEqual(['maps'])
  })

  it('shows the Kappa container picture with the scan advice', async () => {
    open('/kappa-items')
    await settle()
    const dialog = screen.getByRole('dialog', { name: 'Предметы для «Коллекционера»' })
    expect(dialog.querySelector('img')).toHaveAttribute('alt', 'Предметы для «Коллекционера», сложенные в один контейнер в игре')
    expect(dialog).toHaveTextContent('нажмите «Сканировать»')
    expect(dialog).toHaveTextContent('Или отметьте предметы вручную')
  })
})
