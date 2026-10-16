import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SR2M = '62e14904c2699c0ec93adc47'
const easy = {
  id: '669fa3a40c828825de06d6a1', name: 'Легкотня', trader: 'Прапор',
  objectiveDetails: [{ id: 'o', type: 'shoot', count: 5, mapIds: ['reserve'], conditions: { weapons: [{ id: SR2M, name: 'SR-2M' }], mods: [[{ id: 'supp', name: 'Глушитель' }]] } }],
}
const mocks = vi.hoisted(() => ({ loading: false, quests: [] as unknown[] }))
vi.mock('../data/DataProvider', () => ({ useOptionalTarkovData: () => ({ data: { quests: mocks.quests, items: [{ id: SR2M, name: 'Пистолет-пулемёт СР-2М «Вереск»', shortName: 'СР-2М', category: 'Оружие', description: '', prices: [] }] }, initialLoading: mocks.loading }) }))
const { RaidLoadoutTip, RAID_LOADOUT_TIP_KEY } = await import('./RaidLoadoutTip')
const { GUIDE_TIMING } = await import('./guideProgress')

/** The Overview with «Сбор на рейд» (the loading screen while the catalog loads). */
const open = (path = '/') => render(<MemoryRouter initialEntries={[path]}><RaidLoadoutTip />
  {mocks.loading ? <div role="status">Загружаем актуальную базу</div> : <div className="quest-conditions-card">Сбор на рейд</div>}
</MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
  mocks.loading = false
  mocks.quests = [easy]
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

describe('«Сбор на рейд» tip (owner, 15.10.2026)', () => {
  it('points at the block once, explains it and shows «Легкотня» with its weapon', async () => {
    const view = open()
    await settle()
    const dialog = screen.getByRole('dialog', { name: 'Новое: «Сбор на рейд»' })
    expect(dialog).toHaveTextContent('Больше не нужно перед каждым рейдом искать, с каким оружием выполнять квест')
    expect(dialog).toHaveTextContent('Легкотня')
    expect(dialog).toHaveTextContent('Прапор')
    expect(dialog).toHaveTextContent('СР-2М «Вереск»')
    expect(document.querySelector('.frg-layer[data-step="raid-loadout"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Принял' }))
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(RAID_LOADOUT_TIP_KEY)).not.toBeNull()
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('kept as shown when it opens: the next start has none, «Принял» or not (owner, 16.10.2026)', async () => {
    const view = open()
    await settle()
    expect(screen.getByRole('dialog', { name: 'Новое: «Сбор на рейд»' })).toBeInTheDocument()
    expect(localStorage.getItem(RAID_LOADOUT_TIP_KEY)).not.toBeNull()
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('never over the loading screen, and only on the Overview', async () => {
    mocks.loading = true
    const view = open()
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.unmount()
    mocks.loading = false
    open('/maps')
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('waits while another tip is open', async () => {
    const other = document.createElement('div')
    other.className = 'frg-layer'
    other.dataset.step = 'quest-sync'
    document.body.append(other)
    open()
    await settle()
    expect(screen.queryByRole('dialog', { name: 'Новое: «Сбор на рейд»' })).not.toBeInTheDocument()
    other.remove()
    await settle()
    expect(screen.getByRole('dialog', { name: 'Новое: «Сбор на рейд»' })).toBeInTheDocument()
  })
})
