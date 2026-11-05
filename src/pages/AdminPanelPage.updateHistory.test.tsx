import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setRenderLanguage } from '../i18n/renderText'
import { UPDATE_HISTORY_PATH } from '../shared/updateHistory'

/** «История обновлений» in «Админ панель» of the owner's app: a section like the others, read from the owner-only route. */
const owner = vi.hoisted(() => ({ access: 'owner', request: vi.fn() }))
vi.mock('../admin/ownerAccess', async (load) => ({
  ...(await load<typeof import('../admin/ownerAccess')>()),
  useOwnerAccess: () => owner.access,
  ownerRequest: () => owner.request,
}))
const { AdminPanelPage } = await import('./AdminPanelPage')

const versions = [{ version: '0.6.0.244', date: '2026-11-05', changes: ['Запускается только одна копия приложения'] }]
const open = () => render(<MemoryRouter initialEntries={['/admin?tab=history']}><AdminPanelPage /></MemoryRouter>)

beforeEach(() => {
  owner.access = 'owner'
  owner.request.mockReset()
  owner.request.mockImplementation(async (_method: string, path: string) => (path === UPDATE_HISTORY_PATH ? { versions } : {}))
})
afterEach(() => setRenderLanguage('ru'))

describe('«История обновлений» of the owner\'s app', () => {
  it('is one of the sections, and its link opens the table from the server', async () => {
    open()
    expect(screen.getByRole('tab', { name: /История обновлений/ })).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel')
    expect(await within(panel).findByText('05.11.2026')).toBeInTheDocument()
    expect(owner.request).toHaveBeenCalledWith('GET', UPDATE_HISTORY_PATH)
    expect(within(panel).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Версия', 'Дата', 'Что изменилось'])
  })

  it('opens from the list of sections; in English the labels change and the rows stay Russian', async () => {
    setRenderLanguage('en')
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/admin']}><AdminPanelPage /></MemoryRouter>)
    expect(owner.request).not.toHaveBeenCalledWith('GET', UPDATE_HISTORY_PATH)
    await user.click(screen.getByRole('tab', { name: /Update history/ }))
    const panel = screen.getByRole('tabpanel')
    expect(await within(panel).findByText('Запускается только одна копия приложения')).toBeInTheDocument()
    expect(within(panel).getByText('All versions, newest first')).toBeInTheDocument()
    expect(within(panel).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Version', 'Date', 'What changed'])
  })

  it('shows the server\'s refusal and asks nothing on another account', async () => {
    owner.request.mockRejectedValue(new Error('Не найдено'))
    open()
    expect(await within(screen.getByRole('tabpanel')).findByRole('alert')).toHaveTextContent('Не найдено')

    owner.request.mockClear()
    owner.access = 'not-owner'
    const { container } = open()
    expect(container.querySelector('.uh-table')).toBeNull()
    expect(owner.request).not.toHaveBeenCalled()
  })
})
