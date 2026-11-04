import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BugReportDetail, BugReportRow } from './bugReportsApi'
import type { ReportPage } from '../../../../src/reports/ReportsTable'

/**
 * «Отчёты» on the site (owner, 05.11.2026: «убери из отчетов все и сделай там таблицу»): one table of reports and ideas,
 * filling by itself, the owner's buttons in it; a row opens the screenshots (blobs, owner token) and the days for the reporter.
 */
const mocks = vi.hoisted(() => ({ table: vi.fn(), work: vi.fn(), plan: vi.fn(), events: vi.fn(), get: vi.fn(), file: vi.fn(), reward: vi.fn(), mail: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('./bugReportsApi', () => ({ bugReportsApi: mocks }))

const { AdminBugReports } = await import('./AdminBugReports')

const bug: BugReportRow = {
  id: 3, kind: 'bug', email: 'player@example.com', topic: 'Карта не открывается', description: 'Чёрный экран\nна Таможне', appVersion: '0.5.4 · client', platform: 'Windows 10/11 x64 · desktop app',
  status: 'open', createdAt: '2026-10-06T09:00:00.000Z', files: 1, accountId: 'a'.repeat(24), rewardDays: 0,
  triage: { summary: 'Не грузится Таможня', plan: 'Проверить загрузку карты' }, work: { status: 'review' },
}
const idea: BugReportRow = { ...bug, id: 9, kind: 'idea', topic: 'Таймер рейда', description: 'Показывать, сколько осталось', files: 0, triage: undefined }
const page = (rows: BugReportRow[], extra: Partial<ReportPage<BugReportRow>> = {}): ReportPage<BugReportRow> => ({ rows, total: rows.length, counts: { active: rows.length, closed: 4, awaiting: rows.length }, agentSeenAt: new Date().toISOString(), ...extra })
const detail: BugReportDetail = { ...bug, description: bug.description, files: [{ idx: 0, mime: 'image/png', size: 2048 }] } as unknown as BugReportDetail

beforeEach(() => { mocks.events.mockReturnValue(new Promise(() => {})) })
afterEach(() => { cleanup(); for (const mock of Object.values(mocks)) mock.mockReset() })

const row = async (title: string) => (await screen.findByText(title)).closest('tr') as HTMLElement

describe('«Отчёты» on the site', () => {
  it('one table of reports and ideas: a number, the kind, the title, the text, the conclusion, the plan and the status; no system details', async () => {
    mocks.table.mockResolvedValue(page([idea, bug]))
    render(<AdminBugReports />)
    const line = await row('Карта не открывается')
    expect(within(line).getByText('3')).toBeInTheDocument()
    expect(within(line).getByText('Отчёт')).toBeInTheDocument()
    expect(within(line).getByText(/Чёрный экран/)).toBeInTheDocument()
    expect(within(line).getByText('Не грузится Таможня')).toBeInTheDocument()
    expect(within(line).getByRole('textbox', { name: 'План действий' })).toHaveValue('Проверить загрузку карты')
    expect(within(line).getByText('Ожидает проверки')).toBeInTheDocument()
    // Not analysed yet: the cell says so.
    expect(within(await row('Таймер рейда')).getByText('Предложение')).toBeInTheDocument()
    expect(within(await row('Таймер рейда')).getByText(/Разбор ещё не готов/)).toBeInTheDocument()
    expect(screen.queryByText(/Windows/)).toBeNull()
    expect(screen.queryByText(/0\.5\.4/)).toBeNull()
    expect(screen.queryByText('player@example.com')).toBeNull()
    expect(mocks.table).toHaveBeenCalledWith('owner-token', 'active', 50, 0)
    expect(screen.getByRole('button', { name: /^Закрытые/ })).toHaveTextContent('Закрытые · 4')
    expect(screen.getByText(/Ждут проверки/)).toHaveTextContent('Ждут проверки: 2')

    fireEvent.click(screen.getByRole('button', { name: /^Закрытые/ }))
    await waitFor(() => expect(mocks.table).toHaveBeenLastCalledWith('owner-token', 'closed', 50, 0))
  })

  it('«Отдать в работу» sends the plan on the screen; without a plan it cannot be pressed', async () => {
    mocks.table.mockResolvedValue(page([idea, bug]))
    mocks.work.mockResolvedValue({ report: detail })
    render(<AdminBugReports />)
    const line = await row('Карта не открывается')
    const box = within(line).getByRole('textbox', { name: 'План действий' })
    fireEvent.change(box, { target: { value: 'Поправить загрузку' } })
    fireEvent.click(within(line).getByRole('button', { name: 'Отдать в работу' }))
    await waitFor(() => expect(mocks.work).toHaveBeenCalledWith('owner-token', 3, 'approve', 'Поправить загрузку'))
    await waitFor(() => expect(mocks.table).toHaveBeenCalledTimes(2))
    expect(within(await row('Таймер рейда')).getByRole('button', { name: 'Отдать в работу' })).toBeDisabled()
  })

  it('«Отклонить» and «Уже реализовано» on the row; a refusal of the server stays on it', async () => {
    mocks.table.mockResolvedValue(page([bug]))
    mocks.work.mockResolvedValueOnce({ report: detail }).mockRejectedValueOnce(new Error('Отчёт №3 уже в другом статусе: обновите таблицу'))
    render(<AdminBugReports />)
    const line = await row('Карта не открывается')
    fireEvent.click(within(line).getByRole('button', { name: 'Отклонить' }))
    await waitFor(() => expect(mocks.work).toHaveBeenCalledWith('owner-token', 3, 'reject', undefined))
    fireEvent.click(await within(line).findByRole('button', { name: 'Уже реализовано' }))
    expect(await within(line).findByRole('alert')).toHaveTextContent('уже в другом статусе')
  })

  it('leaving the plan box saves a correction, and only a correction', async () => {
    mocks.table.mockResolvedValue(page([bug]))
    mocks.plan.mockResolvedValue({ report: detail })
    render(<AdminBugReports />)
    const box = within(await row('Карта не открывается')).getByRole('textbox', { name: 'План действий' })
    fireEvent.blur(box)
    expect(mocks.plan).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: 'Другой план' } })
    fireEvent.blur(box)
    await waitFor(() => expect(mocks.plan).toHaveBeenCalledWith('owner-token', 3, 'Другой план'))
  })

  it('shows where the work stands: its description, and no plan box or buttons once it is given away and taken', async () => {
    mocks.table.mockResolvedValue(page([
      { ...bug, id: 5, topic: 'Взятый отчёт', work: { status: 'in-progress' } },
      { ...bug, id: 6, topic: 'Сделано', work: { status: 'done', note: 'Исправил загрузку', commit: 'a'.repeat(40) } },
      { ...bug, id: 7, topic: 'Не вышло', work: { status: 'failed', note: 'Оплата: решите сами' } },
      { ...bug, id: 8, topic: 'Отдан', work: { status: 'queued' } },
    ]))
    render(<AdminBugReports />)
    const taken = await row('Взятый отчёт')
    expect(within(taken).queryByRole('textbox')).toBeNull()
    expect(within(taken).queryByRole('button', { name: 'Отклонить' })).toBeNull()
    expect(within(taken).getByText('Проверить загрузку карты')).toBeInTheDocument()
    const done = await row('Сделано')
    expect(within(done).getByText('Выполнено')).toBeInTheDocument()
    expect(within(done).getByText('Исправил загрузку')).toBeInTheDocument()
    const failed = await row('Не вышло')
    expect(within(failed).getByText('Не реализовано')).toBeInTheDocument()
    expect(within(failed).getByText('Оплата: решите сами')).toBeInTheDocument()
    expect(within(failed).getByRole('button', { name: 'Отдать в работу' })).toBeEnabled()
    const queued = await row('Отдан')
    expect(within(queued).getByText('Отдано в работу')).toBeInTheDocument()
    expect(within(queued).getByText(/когда компьютер включён/)).toBeInTheDocument()
    expect(within(queued).getByRole('button', { name: 'Вернуть на проверку' })).toBeInTheDocument()
    expect(within(queued).queryByRole('button', { name: 'Отклонить' })).toBeNull()
  })

  // Owner, 05.11.2026: «одной кнопкой скопировать все данные что бы передать в Клод»; «данные конкретной заявки».
  it('«Копировать» puts this report\u2019s data on the clipboard, that row only', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mocks.table.mockResolvedValue(page([idea, { ...bug, platform: 'Windows 10/11 x64 · desktop app · EFT: Steam' }]))
    render(<AdminBugReports />)
    const line = await row('Карта не открывается')
    fireEvent.click(within(line).getByRole('button', { name: 'Копировать' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0]![0] as string
    for (const part of ['Отчёт №3', 'Почта: player@example.com', 'Windows: Windows 10/11 x64 · desktop app', 'Игра: Steam', 'Версия приложения: 0.5.4 · client', 'Тема: Карта не открывается', 'Чёрный экран\nна Таможне']) expect(text).toContain(part)
    expect(text).not.toContain('Таймер рейда')
    expect(await within(line).findByRole('button', { name: 'Скопировано' })).toBeInTheDocument()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('says it honestly when Claude has not looked in for a long time', async () => {
    mocks.table.mockResolvedValue(page([bug], { agentSeenAt: '2026-10-01T09:00:00.000Z' }))
    render(<AdminBugReports />)
    expect(await screen.findByText(/Claude сейчас не работает/)).toBeInTheDocument()
    cleanup()
    mocks.table.mockResolvedValue(page([bug], { agentSeenAt: new Date().toISOString() }))
    render(<AdminBugReports />)
    expect(await screen.findByText(/Claude проверял/)).toBeInTheDocument()
  })

  it('fills by itself: a change on the server reads the table again, without a reload', async () => {
    let answer!: (value: unknown) => void
    mocks.events.mockReset()
    mocks.events.mockResolvedValueOnce({ version: 1, open: 1, stamp: 1 }).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve })).mockReturnValue(new Promise(() => {}))
    mocks.table.mockResolvedValueOnce(page([bug])).mockResolvedValue(page([{ ...idea, id: 11, topic: 'Новый отчёт игрока' }, bug]))
    render(<AdminBugReports />)
    await row('Карта не открывается')
    expect(screen.queryByText('Новый отчёт игрока')).toBeNull()
    await waitFor(() => expect(mocks.events).toHaveBeenCalledTimes(2))
    expect(mocks.events).toHaveBeenLastCalledWith('owner-token', '/v1/accounts/me/admin/requests/events?since=1')
    answer({ version: 2, open: 2, stamp: 1 })
    expect(await screen.findByText('Новый отчёт игрока')).toBeInTheDocument()
  })

  it('«Подробнее» opens the screenshot and who sent it, the days and the PDF; system details stay hidden there too', async () => {
    mocks.table.mockResolvedValue(page([bug]))
    mocks.get.mockResolvedValue({ report: { ...detail, mailedAt: '2026-10-06T09:00:05.000Z' } })
    mocks.file.mockResolvedValue(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }))
    mocks.reward.mockResolvedValue({ report: { ...detail, rewardDays: 1, rewardedAt: '2026-10-06T10:00:00.000Z', mailedAt: '2026-10-06T09:00:05.000Z' } })
    mocks.mail.mockResolvedValue({ report: { ...detail, mailedAt: '2026-10-06T10:01:00.000Z' } })
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:shot-1'), revokeObjectURL: vi.fn() })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<AdminBugReports />)
    const line = await row('Карта не открывается')
    fireEvent.click(within(line).getByRole('button', { name: 'Подробнее' }))
    expect(await screen.findByText('player@example.com', { selector: 'dd' })).toBeInTheDocument()
    const image = await screen.findByRole('img', { name: 'Скриншот 1' })
    expect(image).toHaveAttribute('src', 'blob:shot-1')
    expect(image.closest('a')).toHaveAttribute('href', 'blob:shot-1')
    expect(mocks.file).toHaveBeenCalledWith('owner-token', 3, 0)
    expect(screen.queryByText(/Windows/)).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: /Выдать \+1 дн\./ }))
    await waitFor(() => expect(mocks.reward).toHaveBeenCalledWith('owner-token', 3, 1))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('player@example.com'))
    expect(await screen.findByText('Выдано +1 дн. player@example.com')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Отправить PDF ещё раз/ }))
    await waitFor(() => expect(mocks.mail).toHaveBeenCalledWith('owner-token', 3))
    expect(await screen.findByText('PDF отправлен на почту')).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('an idea reads «за предложение» for the days', async () => {
    mocks.table.mockResolvedValue(page([idea]))
    mocks.get.mockResolvedValue({ report: { ...idea, files: [] } })
    mocks.reward.mockResolvedValue({ report: { ...idea, files: [], rewardDays: 1 } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminBugReports />)
    fireEvent.click(within(await row('Таймер рейда')).getByRole('button', { name: 'Подробнее' }))
    expect(await screen.findByText('Выдано за предложение')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Выдать \+1 дн\./ }))
    await waitFor(() => expect(mocks.reward).toHaveBeenCalledWith('owner-token', 9, 1))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('за предложение №9'))
    confirm.mockRestore()
  })
})
