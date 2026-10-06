import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BugReportDetail, BugReportList } from './bugReportsApi'

/** «Баг-репорты»: open / closed with counts, a row opens the description and the screenshots (blobs, owner token). */
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), setStatus: vi.fn(), file: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('./bugReportsApi', () => ({ bugReportsApi: mocks }))

const { AdminBugReports } = await import('./AdminBugReports')

const list: BugReportList = {
  reports: [{ id: 3, email: 'player@example.com', topic: 'Карта не открывается', appVersion: '0.5.4 · client', platform: 'Windows 10/11 x64 · desktop app', status: 'open', createdAt: '2026-10-06T09:00:00.000Z', files: 1 }],
  total: 1,
  counts: { open: 1, closed: 4 },
}
const detail: BugReportDetail = { ...list.reports[0]!, description: 'Чёрный экран\nна Таможне', files: [{ idx: 0, mime: 'image/png', size: 2048 }] }

afterEach(() => { cleanup(); for (const mock of Object.values(mocks)) mock.mockReset() })

describe('admin bug reports', () => {
  it('lists open reports with counts, opens one with its screenshot and closes it', async () => {
    mocks.list.mockResolvedValue(list)
    mocks.get.mockResolvedValue({ report: detail })
    mocks.file.mockResolvedValue(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }))
    mocks.setStatus.mockResolvedValue({ report: { ...detail, status: 'closed' } })
    const createObjectURL = vi.fn(() => 'blob:shot-1')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })

    render(<AdminBugReports />)
    expect(await screen.findByText('Карта не открывается')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Открытые/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Закрытые/ })).toHaveTextContent('Закрытые · 4')
    expect(mocks.list).toHaveBeenCalledWith('owner-token', 'open', 50, 0)

    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    expect(await screen.findByText(/Чёрный экран/)).toBeInTheDocument()
    const image = await screen.findByRole('img', { name: 'Скриншот 1' })
    expect(image).toHaveAttribute('src', 'blob:shot-1')
    expect(image.closest('a')).toHaveAttribute('href', 'blob:shot-1')
    expect(mocks.file).toHaveBeenCalledWith('owner-token', 3, 0)

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(mocks.setStatus).toHaveBeenCalledWith('owner-token', 3, 'closed'))
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: /Закрытые/ }))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith('owner-token', 'closed', 50, 0))
  })
})
