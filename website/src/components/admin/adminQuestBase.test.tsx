import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuestBaseModeView, QuestBaseView } from './AdminQuestBase'

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../config', () => ({ API_URL: '/api' }))

const { AdminQuestBase } = await import('./AdminQuestBase')

const mode = (patch: Partial<QuestBaseModeView> = {}): QuestBaseModeView => ({
  version: '1aaed928acf4cf03',
  builtAt: '2026-10-14T09:00:00.000Z',
  checkedAt: '2026-10-14T09:30:00.000Z',
  sources: { wiki: { state: 'cached', fetchedAt: '2026-10-14T08:00:00.000Z' } },
  counts: { quests: 514, bothTitles: 514, storyChapters: 10 },
  changes: { since: null, added: [], removed: [], renamed: [] },
  state: { building: false, failures: 0, lastError: null, nextBuildAt: '2026-10-14T10:00:00.000Z', savedToDisk: true },
  ...patch,
})

const report: QuestBaseView = {
  periodMinutes: 30,
  modes: {
    pvp: mode({ changes: { since: '0f0f0f0f0f0f0f0f', added: [{ id: 'q3', ru: 'Третье', en: 'Third' }], removed: [], renamed: [{ id: 'q1', lang: 'ru', from: 'Старое имя', to: 'Новое имя' }] } }),
    pve: mode({ version: 'd08c6410fc54a9b1', counts: { quests: 510, bothTitles: 510, storyChapters: 10 } }),
    seasonal: mode({ version: null, builtAt: null, checkedAt: null, sources: null, counts: {}, changes: null, state: { building: false, failures: 2, lastError: 'HTTP 502', nextBuildAt: '2026-10-14T09:32:00.000Z', savedToDisk: true } }),
  },
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('admin quest base', () => {
  it('shows each mode\'s version, quests, wiki and builder state, and the changes since the previous version', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(report), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', request)
    render(<AdminQuestBase />)
    const pvp = (await screen.findByRole('rowheader', { name: 'PvP' })).closest('tr')!
    expect(within(pvp).getByText('1aaed928acf4cf03')).toBeInTheDocument()
    expect(pvp).toHaveTextContent('514 · с двумя названиями 514 · глав 10')
    expect(pvp).toHaveTextContent('из сохранённой копии')
    expect(within(pvp).getByText('в порядке')).toBeInTheDocument()
    const season = screen.getByRole('rowheader', { name: 'Сезон' }).closest('tr')!
    expect(season).toHaveTextContent('ещё нет')
    expect(within(season).getByText('ошибка × 2')).toBeInTheDocument()
    expect(season).toHaveTextContent('HTTP 502')
    expect(screen.getByText(/раз в 30 мин/)).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('/api/v1/accounts/me/admin/quest-base', expect.objectContaining({ headers: { authorization: 'Bearer owner-token' } }))

    fireEvent.click(screen.getByText(/PvP: \+1 −0 ~1 с версии/))
    expect(screen.getByText('Третье / Third')).toBeInTheDocument()
    expect(screen.getByText('Старое имя → Новое имя (рус.)')).toBeInTheDocument()
    // PvE has no previous version to compare with, Season has no base yet: no change list.
    expect(screen.queryByText(/PvE:/)).not.toBeInTheDocument()
  })

  it('shows the server\'s refusal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Не найдено' }), { status: 404 })))
    render(<AdminQuestBase />)
    expect(await screen.findByText('Не найдено')).toBeInTheDocument()
  })
})
