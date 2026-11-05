import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setRenderLanguage } from '../i18n/renderText'
import { UpdateHistoryTable } from './UpdateHistoryTable'

/** «История обновлений» in the admin app and on the phone's /admin, and the table itself (also on the site and in the owner's app). */
const updateHistory = vi.hoisted(() => vi.fn())
vi.mock('./adminApi', async (load) => ({
  ...(await load<typeof import('./adminApi')>()),
  // The rest of the page without answers: only this section is under test here.
  adminApi: new Proxy({}, { get: (_target, name) => (name === 'updateHistory' ? updateHistory : () => Promise.reject(new Error('Сервер недоступен'))) }),
}))
const { AdminMobilePage } = await import('./AdminMobilePage')
const { UpdateHistorySheet } = await import('./AdminUpdateHistorySheet')

const rows = [
  { version: '0.6.0.244', date: '2026-11-05', changes: ['Запускается только одна копия приложения'] },
  { version: '0.6.0.243', date: '2026-11-04', changes: ['«Круг сектантов»: картинки сменяются', 'Что выпадает — списком сверху'] },
]

afterEach(() => setRenderLanguage('ru'))

describe('the table', () => {
  it('shows Версия, Дата, Что изменилось; the date as день.месяц.год; every line; in the given order', () => {
    render(<UpdateHistoryTable rows={rows} />)
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Версия', 'Дата', 'Что изменилось'])
    const [first, second] = screen.getAllByRole('row').slice(1)
    expect(within(first!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['0.6.0.244', '05.11.2026', 'Запускается только одна копия приложения'])
    expect(within(second!).getByText('04.11.2026')).toBeInTheDocument()
    expect(within(second!).getAllByRole('listitem').map((item) => item.textContent)).toEqual(rows[1]!.changes)
  })
})

describe('the admin app', () => {
  beforeEach(() => {
    updateHistory.mockReset()
    localStorage.clear()
  })

  it('«История обновлений» opens from «Сводка» in its own window; nothing is asked before that', async () => {
    updateHistory.mockResolvedValue({ versions: rows })
    const user = userEvent.setup()
    render(<AdminMobilePage />)
    const open = await screen.findByRole('button', { name: 'История обновлений' })
    expect(updateHistory).not.toHaveBeenCalled()
    await user.click(open)
    const sheet = await screen.findByRole('dialog', { name: 'История обновлений' })
    expect(await within(sheet).findByText('0.6.0.244')).toBeInTheDocument()
    expect(within(sheet).getByText('05.11.2026')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Назад' }))
    expect(screen.queryByRole('dialog', { name: 'История обновлений' })).not.toBeInTheDocument()
  })

  it('in English the labels change and the rows stay Russian', async () => {
    setRenderLanguage('en')
    updateHistory.mockResolvedValue({ versions: rows })
    render(<UpdateHistorySheet onClose={() => {}} />)
    const sheet = screen.getByRole('dialog', { name: 'Update history' })
    expect(await within(sheet).findByText('Запускается только одна копия приложения')).toBeInTheDocument()
    expect(within(sheet).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Version', 'Date', 'What changed'])
  })

  it('says so when the server refuses', async () => {
    updateHistory.mockRejectedValue(new Error('Не найдено'))
    const user = userEvent.setup()
    render(<AdminMobilePage />)
    await user.click(await screen.findByRole('button', { name: 'История обновлений' }))
    expect(await within(await screen.findByRole('dialog', { name: 'История обновлений' })).findByRole('alert')).toHaveTextContent('Не найдено')
  })
})
