import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeatureTours } from './FeatureTours'
import { GUIDE_TIMING } from './guideProgress'
import { compareReleases, dueTips, LATEST_NEWS_RELEASE, NEWS, readTours, startTours, TOURS_KEY } from './tours'

const status = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('../sync/serverSync', () => ({ useServerStatus: () => status.value }))

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })
/** The Overview's parts the tips point at, drawn like the page. */
const overview = <main className="content"><div className="page">
  <section data-block="tasks">Текущие задания</section><section className="raid-needs">Требования рейда</section><section className="quest-conditions-card">Сбор на рейд</section>
</div></main>
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><FeatureTours />{overview}<nav><Link to="/hideout">к убежищу</Link><Link to="/tier-lists">к тир листам</Link></nav></MemoryRouter>)
const newPlayer = { signedIn: true, email: 'new@example.com', createdAt: new Date().toISOString() }
const oldPlayer = { signedIn: true, email: 'old@example.com', createdAt: '2026-09-01T00:00:00.000Z' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
  status.value = newPlayer
})
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); delete window.tarkovDesktop })

// Owner, 03.11.2026: «дай игроку выбор, показать функции или нажать нет… каждое окно по очереди, но только когда он на
// конкретной вкладке… это только 1 раз при первом входе».
describe('tips about the functions', () => {
  it('a new player is asked once; «Показать» brings the Overview\'s tips one after another, once', async () => {
    renderAt('/')
    await settle()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
    await settle()
    expect(screen.getByRole('dialog', { name: 'Текущие задания' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
    await settle()
    expect(screen.getByRole('dialog', { name: 'Требования рейда' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
    await settle()
    expect(screen.getByRole('dialog', { name: 'Сбор на рейд' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()
    renderAt('/')
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('«Нет, спасибо»: no tips on any tab, ever', async () => {
    renderAt('/')
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Нет, спасибо' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'к убежищу' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readTours()).toMatchObject({ choice: 'no' })
  })

  it('a tab\'s tips wait for that tab: nothing on a tab without tips', async () => {
    localStorage.setItem(TOURS_KEY, JSON.stringify({ choice: 'yes', since: LATEST_NEWS_RELEASE, seen: ['overview:tasks', 'overview:raid-needs', 'overview:loadout'] }))
    renderAt('/')
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'к тир листам' }))
    await settle()
    expect(screen.getByRole('dialog', { name: 'Тир листы' })).toBeInTheDocument()
  })

  it('an existing player is not asked and gets no tour', async () => {
    status.value = oldPlayer
    renderAt('/')
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readTours()).toMatchObject({ choice: 'no', since: '0' })
  })
})

// Owner: «если после обновления выходит новая функция, она показывается всем пользователям 1 раз, при следующем
// обновлении их не надо показывать… а человек еще не заходил ни разу, они не должны появлятся».
describe('news', () => {
  const pc = { phone: false, desktop: true }
  it('the latest release\'s news show once, in their own tab, to a player from before it', () => {
    const record = startTours(false)
    const news = NEWS.filter((item) => item.release === LATEST_NEWS_RELEASE)
    const path = '/maps/customs'
    const due = dueTips(path, record, pc).filter((tip) => tip.news)
    expect(due.map((tip) => tip.key)).toEqual(news.filter((item) => item.matches(path)).map((item) => `news:${item.id}`))
    expect(dueTips('/', record, pc).filter((tip) => tip.news)).toEqual(news.some((item) => item.matches('/')) ? expect.anything() : [])
    expect(dueTips(path, { ...record, seen: due.map((tip) => tip.key) }, pc).filter((tip) => tip.news)).toEqual([])
  })

  it('a player who started with this release gets no news, only the tabs\' tips', () => {
    expect(dueTips('/maps/customs', { choice: 'yes', since: LATEST_NEWS_RELEASE, seen: [] }, pc).some((tip) => tip.news)).toBe(false)
    expect(dueTips('/maps/customs', { choice: 'no', since: LATEST_NEWS_RELEASE, seen: [] }, pc)).toEqual([])
  })

  it('pointers already shown by the earlier «Новое» windows count as seen', () => {
    localStorage.setItem('raidos-new-features-v2', JSON.stringify(['deferred-quests']))
    expect(startTours(false).seen).toContain('news:deferred-quests')
  })

  it('releases compare by number', () => {
    expect(compareReleases('0.6.0.218', '0.6.0.219')).toBeLessThan(0)
    expect(compareReleases('0.6.0-220', '0.6.0.219')).toBeGreaterThan(0)
    expect(compareReleases('0', '0.6.0.218')).toBeLessThan(0)
  })
})
