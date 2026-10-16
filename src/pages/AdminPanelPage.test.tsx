import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { AppStateProvider } from '../state/AppState'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { refreshServerStatus } from '../sync/serverSync'
import { AdminNavLink } from '../admin/AdminNavLink'
import { resetOwnerAccessForTests } from '../admin/ownerAccess'
import { overviewDefaults, reloadOverviewDefaultsForTests, setOverviewDefaults } from '../overview/overviewDefaultsStore'
import { AdminPanelPage } from './AdminPanelPage'

/**
 * «Админ панель» of the owner app (owner, 16.10.2026: «Сделай отдельно в админ приложении, слева над кнопкой обзор Админ
 * панель. в ней должны быть все функции админа»): the sidebar item for the owner only, and every section on the
 * existing owner routes.
 */
const signedIn = { signedIn: true, email: 'owner@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true }
const signedOut = { signedIn: false, online: true, serverUrl: 'https://raidos.app', persistent: true }
const NOT_FOUND = "Error invoking remote method 'service:request': Error: Не найдено"
const notice = { id: 7, kind: 'announcement', title: 'Скидка', text: 'Только сегодня', images: 0, audience: { regions: ['cis'], payment: 'all' }, createdAt: '2026-10-15T10:00:00.000Z', targeted: 12, seen: 5, closed: 3 }
const survey = { id: 8, kind: 'survey', title: 'Как вам?', text: '', images: 0, questions: [], audience: { regions: [], payment: 'all' }, createdAt: '2026-10-15T11:00:00.000Z', targeted: 40, seen: 20, closed: 9, responses: 9 }
const results = { survey, questions: [{ id: 'q1', type: 'single', text: 'Нравится?', answered: 9, options: [{ id: 'a', text: 'Да', count: 6, percent: 66.7 }, { id: 'b', text: 'Нет', count: 3, percent: 33.3 }] }], responses: new Array(9).fill({}) }

async function desktop({ edition = 'owner', owner = true, status = signedIn }: { edition?: 'owner' | 'client'; owner?: boolean; status?: unknown } = {}) {
  let minimap = false
  const serviceRequest = vi.fn(async (method: string, path: string, body?: Record<string, unknown>): Promise<unknown> => {
    if (path.startsWith('/v1/accounts/me/admin/') && !owner) throw new Error(NOT_FOUND)
    if (path === '/v1/accounts/me/admin/features') {
      if (method === 'PUT') minimap = body?.minimap === true
      return { features: { minimap, minimapChangedAt: '', minimapOverlay: true, updatedBy: 'owner@example.com', updatedAt: '2026-10-16T10:00:00.000Z' } }
    }
    if (path === '/v1/accounts/me/admin/notices?kind=announcement') return { notices: [notice] }
    if (path === '/v1/accounts/me/admin/notices?kind=survey') return { notices: [survey] }
    if (path === '/v1/accounts/me/admin/surveys/8/results') return results
    if (path === '/v1/accounts/me/admin/announcement') return { announcement: null }
    if (path === '/v1/accounts/me/admin/overview-defaults') return method === 'PUT' ? { defaults: { ...body, updatedBy: 'owner@example.com', updatedAt: '2026-10-16T10:00:00.000Z' } } : { defaults: null }
    if (path === '/v1/accounts/me/admin/overview-defaults/reset') return { defaults: null }
    if (path === '/v1/accounts/me/admin/quest-points') return { overrides: [{ id: 'p1', questId: 'checking', markerId: 'm1', mapId: 'customs', x: 1, z: 2, kind: 'move', updatedAt: '2026-10-16T09:00:00.000Z' }] }
    if (path === '/v1/accounts/me/admin/quest-texts' || path === '/v1/accounts/me/admin/quest-requirements') return { overrides: [] }
    if (path.includes('event-quests')) return { quests: [] }
    return null
  })
  Object.assign(window, { tarkovDesktop: { isDesktop: true, edition, serviceRequest, account: { status: vi.fn().mockResolvedValue(status), login: vi.fn(), logout: vi.fn() } } })
  await refreshServerStatus()
  return serviceRequest
}

function Where() {
  const location = useLocation()
  return <output aria-label="адрес">{location.pathname}{location.search}</output>
}

function renderPage(route = '/admin') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], demoDataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={[route]}>
        <Routes><Route path="/admin" element={<AdminPanelPage />} /><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}

const calls = (request: ReturnType<typeof vi.fn>, method: string, path: string) => request.mock.calls.filter(([m, p]) => m === method && p === path)

beforeEach(() => {
  localStorage.clear()
  resetOwnerAccessForTests()
  reloadOverviewDefaultsForTests()
})
afterEach(async () => {
  cleanup()
  setRenderLanguage('ru')
  setOverviewDefaults(null)
  await desktop({ edition: 'client', status: signedOut })
  Reflect.deleteProperty(window, 'tarkovDesktop')
})

describe('«Админ панель» in the sidebar', () => {
  const nav = () => render(<MemoryRouter><nav aria-label="Основная навигация"><AdminNavLink locale="ru" /></nav></MemoryRouter>)

  it('is there in the owner app signed in to the owner account', async () => {
    await desktop()
    nav()
    expect(await screen.findByRole('link', { name: 'Админ панель' })).toHaveAttribute('href', '/admin')
  })

  it('is not in the players\' app', async () => {
    const request = await desktop({ edition: 'client' })
    nav()
    expect(screen.queryByRole('link', { name: 'Админ панель' })).toBeNull()
    expect(calls(request, 'GET', '/v1/accounts/me/admin/features')).toHaveLength(0)
  })

  it('goes away when the owner app is signed in to somebody else\'s account', async () => {
    await desktop({ owner: false })
    nav()
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Админ панель' })).toBeNull())
  })

  it('stands right above «Обзор» in the sidebar (src/app/AppShell.tsx)', async () => {
    // The whole shell needs the full desktop bridge; its source shows the place: first in «Основная навигация».
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const shell = readFileSync(resolve(process.cwd(), 'src/app/AppShell.tsx'), 'utf8')
    const list = shell.slice(shell.indexOf('aria-label={uiText("Основная навигация")}'))
    expect(list.indexOf('<AdminNavLink locale={locale} />')).toBeGreaterThan(0)
    expect(list.indexOf('<AdminNavLink locale={locale} />')).toBeLessThan(list.indexOf('navigation.map('))
    expect(shell).toMatch(/const navigation = \[\n  \{ to: '\/', ru: 'Обзор'/)
  })
})

describe('«Админ панель» sections', () => {
  it('lists every section; «Объявления» shows only the announcements and their counts', async () => {
    const request = await desktop()
    renderPage()
    const tabs = screen.getByRole('tablist', { name: 'Разделы админ панели' })
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.querySelector('strong')?.textContent)).toEqual(['Объявления', 'Опросы', 'Баннер', 'Функции', 'Квесты', 'Блоки'])
    expect(await screen.findByText('Скидка')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать объявление' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Создать опрос' })).toBeNull()
    expect(calls(request, 'GET', '/v1/accounts/me/admin/notices?kind=survey')).toHaveLength(0)
    expect(await screen.findByText('аккаунт владельца')).toBeInTheDocument()
  })

  it('«Опросы»: create and see the results here', async () => {
    const user = userEvent.setup()
    const request = await desktop()
    renderPage('/admin?tab=surveys')
    expect(await screen.findByText('Как вам?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать опрос' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Результаты' }))
    const box = await screen.findByRole('region', { name: 'Результаты опроса' })
    expect(within(box).getByText('Да')).toBeInTheDocument()
    expect(within(box).getByText('6 · 66.7 %')).toBeInTheDocument()
    expect(calls(request, 'GET', '/v1/accounts/me/admin/surveys/8/results')).toHaveLength(1)
  })

  it('«Баннер»: the banner for everybody on the existing route', async () => {
    const request = await desktop()
    renderPage('/admin?tab=banner')
    expect(await screen.findByText('Баннер для всех')).toBeInTheDocument()
    await waitFor(() => expect(calls(request, 'GET', '/v1/accounts/me/admin/announcement')).toHaveLength(1))
  })

  it('«Функции»: the position on the map on and off for everybody', async () => {
    const user = userEvent.setup()
    const request = await desktop()
    renderPage('/admin?tab=features')
    expect(await screen.findByText('Выключено у всех')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Включить для всех' }))
    expect(await screen.findByText('Включено у всех')).toBeInTheDocument()
    expect(calls(request, 'PUT', '/v1/accounts/me/admin/features')[0]?.[2]).toEqual({ minimap: true })
  })

  it('«Квесты»: the event quests, the constructor on the map and the quests the owner corrected', async () => {
    const user = userEvent.setup()
    await desktop()
    renderPage('/admin?tab=quests')
    expect(await screen.findByText('Ивент-квесты', { selector: '.panel-title' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить квест' })).toBeInTheDocument()
    const edited = await screen.findByRole('list', { name: 'Квесты с вашими правками' })
    expect(within(edited).getByText('Проверка')).toBeInTheDocument()
    expect(within(edited).getByText(/точек: 1/)).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Найти квест' }), 'Дебю')
    const found = screen.getByRole('list', { name: 'Найденные квесты' })
    await user.click(within(found).getByRole('button', { name: 'Открыть в конструкторе' }))
    expect(screen.getByRole('status', { name: 'адрес' })).toHaveTextContent('/maps/customs?quest=debut&edit=1')
  })

  it('«Квесты» → «Открыть конструктор на карте» opens the map in the editing mode', async () => {
    const user = userEvent.setup()
    await desktop()
    renderPage('/admin?tab=quests')
    await user.click(await screen.findByRole('button', { name: 'Открыть конструктор на карте' }))
    expect(screen.getByRole('status', { name: 'адрес' })).toHaveTextContent('/maps?edit=1')
  })

  it('«Блоки»: hide a block, rename one, move one and save for everybody; this app shows it at once', async () => {
    const user = userEvent.setup()
    const request = await desktop()
    renderPage('/admin?tab=blocks')
    await waitFor(() => expect(calls(request, 'GET', '/v1/accounts/me/admin/overview-defaults')).toHaveLength(1))
    const save = screen.getByRole('button', { name: 'Сохранить для всех' })
    expect(save).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Оружейник: показывать' }))
    await user.type(screen.getByRole('textbox', { name: 'Рынок · избранное: название (RU)' }), 'Мой рынок')
    await user.click(screen.getByRole('button', { name: 'Рынок · избранное: выше' }))
    await user.click(screen.getByRole('tab', { name: /Телефон/ }))
    await user.click(screen.getByRole('button', { name: 'План рейда: выше' }))
    await user.click(save)
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено')
    const body = calls(request, 'PUT', '/v1/accounts/me/admin/overview-defaults')[0]?.[2] as { hidden: string[]; titles: Record<string, { ru: string; en: string }>; layout: { right: string[] }; phone: string[] }
    expect(body.hidden).toEqual(['gunsmith'])
    expect(body.titles).toEqual({ favorites: { ru: 'Мой рынок', en: '' } })
    expect(body.layout.right).toEqual(['tasks', 'favorites', 'gunsmith'])
    expect(body.phone.indexOf('raid')).toBe(4)
    expect(overviewDefaults()?.hidden).toEqual(['gunsmith'])
  })

  it('asks to sign in when the owner app has no session', async () => {
    await desktop({ status: signedOut })
    renderPage('/admin?tab=blocks')
    expect(await screen.findByText(/Войдите в аккаунт владельца на странице «Профиль»/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть профиль' })).toHaveAttribute('href', '/profile')
  })

  it('in English', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    setRenderLanguage('en')
    await desktop()
    renderPage('/admin?tab=features')
    expect(screen.getByRole('heading', { name: 'Admin panel' })).toBeInTheDocument()
    expect(within(screen.getByRole('tablist')).getAllByRole('tab').map((tab) => tab.querySelector('strong')?.textContent)).toEqual(['Announcements', 'Surveys', 'Banner', 'Features', 'Tasks', 'Blocks'])
    expect(await screen.findByText('Off for everybody')).toBeInTheDocument()
    expect(screen.getByText('Position on the map')).toBeInTheDocument()
  })
})
