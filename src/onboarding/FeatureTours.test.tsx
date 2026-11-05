import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, NavLink, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { releaseWindowTurn, requestWindowTurn } from '../app/windowTurn'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { FeatureTours } from './FeatureTours'
import { GUIDE_TIMING } from './guideProgress'
import { compareReleases, dueTips, LATEST_NEWS_RELEASE, NEWS, readTours, startTours, TOURS_KEY } from './tours'

const status = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('../sync/serverSync', () => ({ useServerStatus: () => status.value }))
const raid = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('../app/useRaidState', () => ({ useRaidState: () => raid.value, raidRunning: (state: { inRaid?: boolean } | null) => Boolean(state?.inRaid) }))

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
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); delete window.tarkovDesktop; raid.value = null; setRenderLanguage('ru') })

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
    expect(screen.queryByRole('dialog', { name: 'Показать возможности Raid OS?' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Текущие задания' })).toBeNull()
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

// Owner, 05.11.2026: «уведомление о новой функции торговли должно быть посередине, как у нас все всплывающие окна с указателем. На кнопку и должно быть объявление».
describe('«Новое: Торговля»', () => {
  function Where() {
    return <span data-testid="where">{useLocation().pathname}</span>
  }
  /** The app's menu, with «Торговля» at a place on the screen (jsdom draws nothing). */
  const renderMenu = (path = '/', menu = true) => {
    const view = render(<LocaleProvider><MemoryRouter initialEntries={[path]}>
      {menu && <aside><NavLink className="nav-link" to="/economy/trading">Торговля</NavLink></aside>}
      <FeatureTours />{overview}<Where />
    </MemoryRouter></LocaleProvider>)
    const link = document.querySelector('.nav-link')
    if (link) {
      link.getClientRects = () => [{}] as unknown as DOMRectList
      link.getBoundingClientRect = () => ({ left: 0, top: 300, width: 220, height: 36, right: 220, bottom: 336, x: 0, y: 300, toJSON: () => ({}) })
    }
    return view
  }
  const placed = () => act(async () => {
    await vi.advanceTimersByTimeAsync(600)
    await vi.advanceTimersByTimeAsync(100)
  })
  const dialog = () => screen.queryByRole('dialog', { name: 'Новое: Торговля' })
  beforeEach(() => { status.value = oldPlayer })

  it('stands in the middle of the window, the button lit up and the pointer right beside it, with its few words', async () => {
    renderMenu()
    await placed()
    expect(dialog()).toBeInTheDocument()
    const card = document.querySelector<HTMLElement>('.frg-card')!
    expect(card.style.left).toBe(`${window.innerWidth / 2}px`)
    expect(card.style.top).toBe(`${window.innerHeight / 2}px`)
    const pointer = document.querySelector<HTMLElement>('.frg-pointer.is-left')!
    expect(pointer.style.left).toBe('243px')
    expect(pointer.style.top).toBe('303px')
    expect(document.querySelector<HTMLElement>('.frg-spot')!.style.top).toBe('294px')
    expect(screen.getByText(/«Продажа модулей»/)).toBeInTheDocument()
    expect(screen.getByText(/Не гарантия заработка, а статистика/)).toBeInTheDocument()
  })

  it('in English too', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    renderMenu()
    await placed()
    expect(screen.getByRole('dialog', { name: 'New: Trading' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  it('«Понятно» closes it for good', async () => {
    renderMenu()
    await placed()
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }))
    await placed()
    expect(dialog()).toBeNull()
    expect(document.querySelector('.frg-spot')).toBeNull()
    cleanup()
    renderMenu()
    await placed()
    expect(dialog()).toBeNull()
  })

  it('«Открыть» goes to the page, once', async () => {
    renderMenu()
    await placed()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    await placed()
    expect(screen.getByTestId('where').textContent).toBe('/economy/trading')
    expect(dialog()).toBeNull()
    expect(readTours()?.seen).toContain('news:trading')
  })

  it('waits its turn behind another window that opened by itself', async () => {
    requestWindowTurn('another-window')
    renderMenu()
    await placed()
    expect(dialog()).toBeNull()
    act(() => releaseWindowTurn('another-window'))
    await placed()
    expect(dialog()).toBeInTheDocument()
  })

  it('not over the page itself: being there counts as seen', async () => {
    renderMenu('/economy/trading')
    await placed()
    expect(dialog()).toBeNull()
    expect(readTours()?.seen).toContain('news:trading')
  })

  it('not in a raid, and it is still to come after it', async () => {
    raid.value = { inRaid: true }
    const view = renderMenu()
    await placed()
    expect(dialog()).toBeNull()
    expect(readTours()?.seen).not.toContain('news:trading')
    raid.value = null
    view.unmount()
    renderMenu()
    await placed()
    expect(dialog()).toBeInTheDocument()
  })

  it('who closed the window 0.6.0.246 showed is not told again', async () => {
    localStorage.setItem('raidos-trading-intro-v1', '1')
    renderMenu()
    await placed()
    expect(dialog()).toBeNull()
  })

  it('a new player gets no news of the release they started with', async () => {
    status.value = newPlayer
    renderMenu()
    await placed()
    expect(dialog()).toBeNull()
  })

  it('on the page itself the next news points at the new button, and only there (owner, 05.11.2026)', async () => {
    render(<LocaleProvider><MemoryRouter initialEntries={['/economy/trading']}>
      <FeatureTours /><main className="content"><div className="page"><div className="trading-views"><button type="button" className="trading-view-traders">Продажа торговцам</button></div></div></main>
    </MemoryRouter></LocaleProvider>)
    const button = document.querySelector('.trading-view-traders')!
    button.getClientRects = () => [{}] as unknown as DOMRectList
    button.getBoundingClientRect = () => ({ left: 600, top: 100, width: 160, height: 32, right: 760, bottom: 132, x: 600, y: 100, toJSON: () => ({}) })
    await placed()
    expect(screen.getByRole('dialog', { name: 'Новое: Продажа торговцам' })).toBeInTheDocument()
    expect(document.querySelector('.frg-pointer')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }))
    await placed()
    expect(readTours()?.seen).toContain('news:trader-sales')
  })

  it('off the page there is no pointer at the button', async () => {
    renderMenu()
    await placed()
    expect(screen.queryByRole('dialog', { name: 'Новое: Продажа торговцам' })).toBeNull()
  })

  it('with no menu to point at, on a phone, it stands in the middle without a pointer', async () => {
    renderMenu('/', false)
    await placed()
    expect(dialog()).toBeInTheDocument()
    expect(document.querySelector('.frg-pointer')).toBeNull()
    expect(document.querySelector('.frg-dim')).toBeInTheDocument()
  })
})
