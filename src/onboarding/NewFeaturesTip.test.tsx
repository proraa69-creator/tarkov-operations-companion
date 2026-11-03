import '@testing-library/jest-dom/vitest'
import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, NavLink, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewFeaturesTip, NEW_FEATURES_TIP_KEY } from './NewFeaturesTip'
import { GUIDE_TIMING } from './guideProgress'

const nav: { go?: (path: string) => void } = {}
function Navigator() {
  const navigate = useNavigate()
  useEffect(() => { nav.go = (path) => { void navigate(path) } })
  return null
}

/** The PC Overview with the menu, «Требования рейда» and «Рынок · избранное». */
const open = (path = '/') => render(<MemoryRouter initialEntries={[path]}><NewFeaturesTip /><Navigator />
  <nav className="sidebar"><NavLink className="nav-link" to="/quests">Квесты</NavLink><NavLink className="nav-link" to="/maps">Карты</NavLink></nav>
  <section className="raid-needs">Требования рейда</section><section className="market-favorites">Рынок · избранное</section>
</MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })
const accept = async () => { fireEvent.click(screen.getByRole('button', { name: 'Принял' })); await settle() }
const desktopWidth = window.innerWidth
const seen = () => JSON.parse(localStorage.getItem(NEW_FEATURES_TIP_KEY) ?? '[]') as string[]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(Date.UTC(2026, 10, 3, 12))
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); Object.assign(window, { innerWidth: desktopWidth }) })

describe('pointers at the new sections', () => {
  it('shows each new pointer in turn, the next after «Принял», and never one seen before (owner, 03.11.2026)', async () => {
    const view = open()
    await settle()
    const deferred = screen.getByRole('dialog', { name: 'Новое: отложенные квесты' })
    expect(deferred).toHaveTextContent('Нет ключа или нужного предмета для выполнения квеста? Можете временно убрать квест, чтобы он не мешал в общем списке')
    expect(deferred).not.toHaveTextContent('правой кнопкой')
    expect(seen()).toEqual(['deferred-quests'])
    await accept()
    const overview = screen.getByRole('dialog', { name: 'Новое: отложить квест с главного экрана' })
    expect(overview).toHaveTextContent('Нажмите правой кнопкой мыши на предмет в «Требованиях рейда», на снаряжение в «Сборе на рейд» или на квест в «Текущих заданиях»')
    expect(overview).toHaveTextContent('на 1–7 дней или до уровня')
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    await accept()
    const favorites = screen.getByRole('dialog', { name: 'Новое: предметы отложенных квестов в избранном' })
    expect(favorites).toHaveTextContent('сами добавляются в «Избранное»')
    expect(favorites).toHaveTextContent('переключатель «Предметы в избранное» справа')
    await accept()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(seen()).toEqual(['deferred-quests', 'defer-overview', 'deferred-favorites'])
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the pointer seen in 0.6.0.196 is not shown again; the new ones are', async () => {
    localStorage.setItem('raidos-new-features-0-6-0-196-v1', '2026-11-03T08:00:00.000Z')
    open()
    await settle()
    expect(screen.getByRole('dialog', { name: 'Новое: отложить квест с главного экрана' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Новое: отложенные квесты' })).toBeNull()
  })

  it('one left unread on another page comes when the Overview opens again; a restart shows only the ones not seen', async () => {
    const view = open()
    await settle()
    await accept()
    expect(screen.getByRole('dialog', { name: 'Новое: отложить квест с главного экрана' })).toBeInTheDocument()
    act(() => nav.go!('/maps'))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => nav.go!('/'))
    await settle()
    expect(screen.getByRole('dialog', { name: 'Новое: предметы отложенных квестов в избранном' })).toBeInTheDocument()
    view.unmount()
    // a restart: everything shown so far is seen
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a restart before the last one continues with the ones not shown', async () => {
    localStorage.setItem(NEW_FEATURES_TIP_KEY, JSON.stringify(['deferred-quests']))
    open()
    await settle()
    expect(screen.getByRole('dialog', { name: 'Новое: отложить квест с главного экрана' })).toBeInTheDocument()
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
