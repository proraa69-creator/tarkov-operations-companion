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
const page = (rows: BugReportRow[], extra: Partial<ReportPage<BugReportRow>> = {}): ReportPage<BugReportRow> => ({ rows, total: rows.length, counts: { active: rows.length, working: 1, closed: 4, awaiting: rows.length }, agentSeenAt: new Date().toISOString(), ...extra })
const detail: BugReportDetail = { ...bug, description: bug.description, files: [{ idx: 0, mime: 'image/png', size: 2048 }] } as unknown as BugReportDetail

beforeEach(() => { mocks.events.mockReturnValue(new Promise(() => {})) })
afterEach(() => { cleanup(); for (const mock of Object.values(mocks)) mock.mockReset() })

const row = async (title: string) => (await screen.findByText(title)).closest('tr') as HTMLElement

describe('«Отчёты» on the site', () => {
  it('one table of reports and ideas: a number, the kind, the title, the text, who wrote it', async () => {
    mocks.table.mockResolvedValue(page([idea, { ...bug, nickname: 'Shturman_77' }]))
    mocks.file.mockResolvedValue(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }))
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:shot-1'), revokeObjectURL: vi.fn() })
    render(<AdminBugReports />)
    const line = await row('Карта не открывается')
    expect(within(line).getByText('3')).toBeInTheDocument()
    expect(within(line).getByText('Отчёт')).toBeInTheDocument()
    expect(within(line).getByText(/Чёрный экран/)).toBeInTheDocument()
    for (const fact of ['player@example.com', 'Shturman_77', '0.5.4 · client']) expect(within(line).getByText(fact)).toBeInTheDocument()
    expect(within(line).queryByText('Ожидает проверки')).toBeNull()
    expect(within(line).queryByRole('textbox')).toBeNull()
    expect(screen.queryByText(/Claude/)).toBeNull()
    expect(within(await row('Таймер рейда')).getByText('Предложение')).toBeInTheDocument()
    expect(mocks.table).toHaveBeenCalledWith('owner-token', 'active', 50, 0)
    expect(screen.getByRole('button', { name: /^Закрытые/ })).toHaveTextContent('Закрытые · 4')
    expect(screen.getByRole('button', { name: /^В процессе/ })).toHaveTextContent('В процессе · 1')

    fireEvent.click(screen.getByRole('button', { name: /^В процессе/ }))
    await waitFor(() => expect(mocks.table).toHaveBeenLastCalledWith('owner-token', 'working', 50, 0))
    fireEvent.click(screen.getByRole('button', { name: /^Закрытые/ }))
    await waitFor(() => expect(mocks.table).toHaveBeenLastCalledWith('owner-token', 'closed', 50, 0))
  })

  it('the screenshot stands right in the row; a click opens it over the page', async () => {
    mocks.table.mockResolvedValue(page([bug]))
    mocks.file.mockResolvedValue(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }))
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:shot-1'), revokeObjectURL: vi.fn() })
    render(<AdminBugReports />)
    const image = await within(await row('Карта не открывается')).findByRole('img', { name: 'Скриншот 1' })
    expect(image).toHaveAttribute('src', 'blob:shot-1')
    expect(mocks.file).toHaveBeenCalledWith('owner-token', 3, 0)
    fireEvent.click(image.closest('button')!)
    const viewer = await screen.findByRole('dialog', { name: 'Изображение 1 из 1' })
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', 'blob:shot-1')
  })

  it('«Взял в работу», «Уже реализовано», «Отменить» on the row; the new status shows at the press, a refusal of the server takes it back', async () => {
    mocks.table.mockResolvedValue(page([{ ...bug, files: 0 }, { ...bug, id: 4, files: 0, topic: 'Второй отчёт' }]))
    mocks.work.mockResolvedValueOnce({ report: detail }).mockRejectedValueOnce(new Error('Отчёт №4 уже в другом статусе: обновите таблицу'))
    render(<AdminBugReports />)
    const line = await row('Карта не открывается')
    expect(within(line).queryByRole('button', { name: 'Отдать в работу' })).toBeNull()
    expect(within(line).getByRole('button', { name: 'Отменить' })).toBeTruthy()
    fireEvent.click(within(line).getByRole('button', { name: 'Взял в работу' }))
    // at once (owner, 11.11.2026: «при нажатии кнопок сильная задержка»): the buttons of «в процессе», before any answer
    expect(within(line).getByRole('button', { name: 'Готово' })).toBeTruthy()
    await waitFor(() => expect(mocks.work).toHaveBeenCalledWith('owner-token', 3, 'take'))
    await waitFor(() => expect(mocks.table).toHaveBeenCalledTimes(2))
    const second = await row('Второй отчёт')
    fireEvent.click(within(second).getByRole('button', { name: 'Уже реализовано' }))
    await waitFor(() => expect(mocks.work).toHaveBeenCalledWith('owner-token', 4, 'already'))
    expect(await within(second).findByRole('alert')).toHaveTextContent('уже в другом статусе')
    // refused: its own buttons are back
    expect(within(second).getByRole('button', { name: 'Взял в работу' })).toBeTruthy()
  })

  it('in the work: «Готово» and the way back; closed: only the way back', async () => {
    mocks.table.mockResolvedValue(page([
      { ...bug, id: 5, files: 0, topic: 'Делаю сам', work: { status: 'taken' } },
      { ...bug, id: 6, files: 0, topic: 'Сделал сам', status: 'closed', work: { status: 'implemented' } },
      { ...bug, id: 7, files: 0, topic: 'Отменён', status: 'closed', work: { status: 'rejected' } },
    ]))
    mocks.work.mockResolvedValue({ report: detail })
    render(<AdminBugReports />)
    const names = (line: HTMLElement) => within(line).getAllByRole('button').map((button) => button.textContent)
    const taken = await row('Делаю сам')
    expect(names(taken)).toEqual(['Готово', 'Вернуть в активные', 'Копировать', 'Подробнее'])
    expect(within(taken).queryByText('В процессе')).toBeNull()
    fireEvent.click(within(taken).getByRole('button', { name: 'Готово' }))
    // «Выдать 1 день?»: «Нет» only closes it
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }))
    await waitFor(() => expect(mocks.work).toHaveBeenCalledWith('owner-token', 5, 'implemented'))
    const done = await row('Сделал сам')
    expect(within(done).getByText('Готово')).toBeInTheDocument()
    expect(names(done)).toEqual(['Вернуть в активные', 'Копировать', 'Подробнее'])
    expect(within(await row('Отменён')).getByText('Отменено')).toBeInTheDocument()
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

  it('«Подробнее» grows the row with the days and the PDF; no second line under it', async () => {
    mocks.table.mockResolvedValue(page([{ ...bug, files: 0 }]))
    mocks.get.mockResolvedValue({ report: { ...detail, mailedAt: '2026-10-06T09:00:05.000Z' } })
    mocks.reward.mockResolvedValue({ report: { ...detail, rewardDays: 1, rewardedAt: '2026-10-06T10:00:00.000Z', mailedAt: '2026-10-06T09:00:05.000Z' } })
    mocks.mail.mockResolvedValue({ report: { ...detail, mailedAt: '2026-10-06T10:01:00.000Z' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<AdminBugReports />)
    const line = await row('Карта не открывается')
    const rows = line.parentElement!.children.length
    fireEvent.click(within(line).getByRole('button', { name: 'Подробнее' }))
    expect(await within(line).findByRole('button', { name: /Выдать \+1 дн\./ })).toBeInTheDocument()
    expect(line.parentElement!.children.length).toBe(rows)

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
