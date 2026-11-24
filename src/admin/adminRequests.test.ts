import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../sync/webAccount', () => ({
  webServiceRequest: mocks.request,
  isServerUnavailable: (error: unknown) => (error as { unavailable?: boolean } | null)?.unavailable === true,
}))

const { adminApi, adminKept, adminPaths } = await import('./adminApi')
const { forgetKeptAnswers } = await import('./adminKeep')

const unavailable = () => Object.assign(new Error('Сервер недоступен'), { unavailable: true })
const reports = (open: number) => ({ reports: [], total: 0, counts: { open, closed: 0 } })
const overview = { generatedAt: '2026-11-03T03:00:00.000Z', users: { total: 12, today: 1, days7: 3, days30: 9, blocked: 0 } }

// Owner, 03.11.2026: «иногда пишет, что связи нет… долго загружает. Оптимизируй его».
describe('how the owner app asks the server', () => {
  beforeEach(() => { mocks.request.mockReset(); adminApi.forget(); localStorage.clear() })

  it('the same request asked at once goes out once, and its answer serves a few seconds more', async () => {
    let answer!: (value: unknown) => void
    mocks.request.mockReturnValue(new Promise((resolve) => { answer = resolve }))
    const both = Promise.all([adminApi.bugReports('open', 1), adminApi.bugReports('open', 1)])
    answer(reports(2))
    expect((await both).map((list) => list.counts.open)).toEqual([2, 2])
    expect((await adminApi.bugReports('open', 1)).counts.open).toBe(2)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    // «Обновить» asks the server again.
    adminApi.forget()
    mocks.request.mockResolvedValue(reports(3))
    expect((await adminApi.bugReports('open', 1)).counts.open).toBe(3)
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('a request that got no answer is asked once more; a refusal of the server is not', async () => {
    mocks.request.mockRejectedValueOnce(unavailable()).mockResolvedValueOnce(overview)
    expect(await adminApi.overview()).toEqual(overview)
    expect(mocks.request).toHaveBeenCalledTimes(2)
    mocks.request.mockReset()
    mocks.request.mockRejectedValueOnce(Object.assign(new Error('Не найдено'), { status: 404 }))
    await expect(adminApi.referrals('', 'invited')).rejects.toThrow('Не найдено')
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('the answers the screens open with are kept for the next start; a change makes the next request go to the server', async () => {
    mocks.request.mockResolvedValue(overview)
    await adminApi.overview()
    expect(adminKept(adminPaths.overview())?.value).toEqual(overview)
    // The bottom bar's small request is not kept.
    mocks.request.mockResolvedValue(reports(1))
    await adminApi.bugReports('open', 1)
    expect(adminKept(adminPaths.bugReports('open', 1))).toBeNull()
    mocks.request.mockResolvedValue({ ok: true })
    await adminApi.markRefunded('a'.repeat(24))
    mocks.request.mockResolvedValue({ ...overview, users: { ...overview.users, total: 13 } })
    expect((await adminApi.overview()).users.total).toBe(13)
    expect(mocks.request).toHaveBeenCalledTimes(4)
    forgetKeptAnswers()
    expect(adminKept(adminPaths.overview())).toBeNull()
  })
})
