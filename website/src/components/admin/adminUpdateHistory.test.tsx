import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** «История обновлений» of the site's admin panel: a tab like the others, the owner's only. */
const auth = vi.hoisted(() => ({ account: { email: 'owner@example.com', owner: true } as { email: string; owner: boolean } }))
vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: auth.account }) }))
const { AdminPage } = await import('../../pages/AdminPage')

const PATH = '/v1/accounts/me/admin/update-history'
const versions = [
  { version: '0.6.0.244', date: '2026-11-05', changes: ['Запускается только одна копия приложения'] },
  { version: '0.6.0.243', date: '2026-11-04', changes: ['«Круг сектантов»: картинки сменяются', 'Что выпадает — списком сверху'] },
]
const server = (answer: () => Response) => {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => (String(url).endsWith(PATH) ? answer() : Response.json({ error: 'Не найдено' }, { status: 404 })))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const asked = (fetch: ReturnType<typeof server>) => fetch.mock.calls.filter(([url]) => String(url).endsWith(PATH))
const open = (entry = '/admin?tab=history') => render(<MemoryRouter initialEntries={[entry]}><AdminPage /></MemoryRouter>)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  auth.account = { email: 'owner@example.com', owner: true }
})

describe('admin «История обновлений»', () => {
  it('its link opens the table, newest first, the date as день.месяц.год', async () => {
    const fetch = server(() => Response.json({ versions }))
    open()
    expect(screen.getByRole('tab', { name: 'История обновлений' })).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel')
    expect(await within(panel).findByText('05.11.2026')).toBeInTheDocument()
    expect(within(panel).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Версия', 'Дата', 'Что изменилось'])
    expect(within(panel).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]!.textContent)).toEqual(['0.6.0.244', '0.6.0.243'])
    expect(asked(fetch)[0]![1]).toMatchObject({ headers: { authorization: 'Bearer owner-token' } })
  })

  it('opens from the tabs, and is not asked before that', async () => {
    const fetch = server(() => Response.json({ versions }))
    const user = userEvent.setup()
    open('/admin')
    expect(asked(fetch)).toHaveLength(0)
    await user.click(screen.getByRole('tab', { name: 'История обновлений' }))
    expect(await screen.findByText('Запускается только одна копия приложения')).toBeInTheDocument()
  })

  it('an account that is not the owner\'s sees no tab and asks nothing', () => {
    auth.account = { email: 'player@example.com', owner: false }
    const fetch = server(() => Response.json({ versions }))
    open()
    expect(screen.getByText('Эта страница доступна только владельцу сервиса.')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'История обновлений' })).not.toBeInTheDocument()
    expect(asked(fetch)).toHaveLength(0)
  })

  it('an older server without the route: says so instead of an empty table', async () => {
    server(() => Response.json({ error: 'Не найдено' }, { status: 404 }))
    open()
    expect(await within(screen.getByRole('tabpanel')).findByText('Не найдено')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
