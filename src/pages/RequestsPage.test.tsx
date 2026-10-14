import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDataset } from '../domain/types'
import type { OwnerReport } from '../data/ownerRequests'

/** «Заявки» (owner app, owner 13.10.2026): agreeing quest corrections grouped; the owner applies, closes, grants days. */
const data = {
  quests: [{ id: 'q1', name: 'Посылка из прошлого', trader: 'Прапор', description: '', level: 5, kappa: false, rewards: [], objectives: [] }],
  maps: [{ id: 'customs', name: 'Таможня' }], markers: [],
} as unknown as AppDataset
vi.mock('../data/DataProvider', () => ({ useOptionalTarkovData: () => ({ data }) }))

const { RequestsPage, groupQuestReports } = await import('./RequestsPage')
const { RequestsNavButton } = await import('../components/RequestsNavButton')

const quest = (id: number, x: number, z: number, extra: Partial<OwnerReport> = {}): OwnerReport => ({
  id, kind: 'bug', category: 'quest', topic: 'Квест «Посылка из прошлого»: точка стоит не там', appVersion: '0.6.0-28 · client', platform: 'Windows',
  status: 'open', createdAt: `2026-10-13T1${id}:00:00.000Z`, files: 0, rewardDays: 0, email: `p${id}@mail.ru`, matches: 2, group: 'point:q1:customs:0',
  quest: { questId: 'q1', issue: 'wrong-point', mode: 'pvp', mapId: 'customs', markerId: 'customs-quest-zone-q1-z1', objectiveId: 'o1', point: { x, z }, pointNote: `заметка ${id}` },
  ...extra,
})
const bug: OwnerReport = { id: 7, kind: 'bug', category: 'map', topic: 'Карта не открывается', appVersion: '0.6.0-28 · client', platform: 'Windows', status: 'open', createdAt: '2026-10-13T09:00:00.000Z', files: 0, rewardDays: 0, email: 'bug@mail.ru' }

afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(window, 'tarkovDesktop') })

function ownerApp(reports: OwnerReport[], edition: 'owner' | 'client' = 'owner') {
  const calls: Array<[string, string, unknown]> = []
  const serviceRequest = vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push([method, path, body])
    if (path.startsWith('/v1/accounts/me/admin/bug-reports?status=open')) return { reports }
    if (path.startsWith('/v1/accounts/me/admin/bug-reports?status=closed')) return { reports: [] }
    if (path.startsWith('/v1/accounts/me/admin/requests/events')) return path.includes('since') ? new Promise(() => {}) : { version: 5, open: reports.length }
    if (path === '/v1/accounts/me/admin/quest-points') return { overrides: [] }
    return { report: reports[0] }
  })
  Object.assign(window, { tarkovDesktop: { edition, isDesktop: true, serviceRequest, account: { status: vi.fn().mockResolvedValue({ signedIn: true, email: 'owner@raidos.app', online: true, serverUrl: 'https://raidos.app', persistent: true }) } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/requests']}>
        <RequestsNavButton locale="ru" />
        <Routes>
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/maps/:mapId" element={<p>map page</p>} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { calls, view }
}

describe('«Заявки»', () => {
  it('groups the agreeing corrections with the average place, the most agreed first', () => {
    const groups = groupQuestReports([quest(1, 100, -40), quest(2, 108, -36), quest(3, 160, -40, { matches: 1, group: 'point:q1:customs:1' }), bug])
    expect(groups.map((group) => [group.key, group.matches, group.point])).toEqual([
      ['point:q1:customs:0', 2, { x: 104, z: -38 }], ['point:q1:customs:1', 1, { x: 160, z: -40 }],
    ])
    expect(groups[0]).toMatchObject({ questId: 'q1', issue: 'wrong-point', mapId: 'customs', markerId: 'customs-quest-zone-q1-z1', objectiveId: 'o1' })
  })

  it('the sidebar button shows the open count in the owner app only', async () => {
    ownerApp([quest(1, 100, -40), quest(2, 108, -36), bug])
    const nav = await screen.findByRole('navigation', { name: 'Заявки' })
    expect(await within(nav).findByLabelText('Открытых заявок: 3')).toHaveTextContent('3')
    cleanup()
    ownerApp([bug], 'client')
    expect(screen.queryByRole('navigation', { name: 'Заявки' })).toBeNull()
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('«Перенести точку сюда» moves the wrong point to the agreed place for everybody and closes the requests; days go to every sender', async () => {
    const { calls } = ownerApp([quest(1, 100, -40), quest(2, 108, -36), bug])
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    expect(await screen.findByRole('heading', { name: 'Посылка из прошлого' })).toBeInTheDocument()
    expect(screen.getByText('Совпадает у 2')).toBeInTheDocument()
    expect(screen.getByText('К точке: заметка 1', { exact: false })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Начислить дни' }))
    await waitFor(() => expect(calls.filter(([, path]) => path.endsWith('/reward')).map(([, path, body]) => [path, body])).toEqual([
      ['/v1/accounts/me/admin/bug-reports/1/reward', { days: 1 }], ['/v1/accounts/me/admin/bug-reports/2/reward', { days: 1 }],
    ]))

    await user.click(screen.getByRole('button', { name: 'Перенести точку сюда' }))
    await waitFor(() => expect(calls.some(([method, path]) => method === 'PUT' && path === '/v1/accounts/me/admin/quest-points')).toBe(true))
    expect(calls.find(([method]) => method === 'PUT')![2]).toEqual({ questId: 'q1', markerId: 'customs-quest-zone-q1-z1', mapId: 'customs', x: 104, z: -38, kind: 'move', objectiveId: 'o1', note: 'По заявкам №1, №2' })
    await waitFor(() => expect(calls.filter(([, path]) => path.endsWith('/status')).map(([, path, body]) => [path, body])).toEqual([
      ['/v1/accounts/me/admin/bug-reports/1/status', { status: 'closed' }], ['/v1/accounts/me/admin/bug-reports/2/status', { status: 'closed' }],
    ]))
    expect(await screen.findByText('Точка применена, заявки закрыты')).toBeInTheDocument()
  })

  it('«Открыть в конструкторе» opens the quest on its map with the agreed place; bug reports have their own tab', async () => {
    ownerApp([quest(1, 100, -40), quest(2, 108, -36), bug])
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /Ошибки/ }))
    expect(screen.getByRole('heading', { name: 'Карта не открывается' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Квесты/ }))
    await user.click(screen.getByRole('button', { name: 'Открыть в конструкторе' }))
    expect(await screen.findByText('map page')).toBeInTheDocument()
  })
})
