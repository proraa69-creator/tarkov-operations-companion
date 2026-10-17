import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDataset, Quest } from '../domain/types'

/** «Сообщить об ошибке» → «Квест» (owner, 13.10.2026): the quest found by search, what is wrong, notes, sent as `quest`. */
const quest: Quest = {
  id: 'q-parcel', name: 'Посылка из прошлого', trader: 'Прапор', description: '', level: 5, kappa: false, rewards: [],
  objectives: ['Найти посылку'], objectiveIds: ['o1'], objectiveDetails: [{ id: 'o1', type: 'visit', description: 'Найти посылку', count: 1 }],
}
const data = { quests: [quest], markers: [], maps: [] } as unknown as AppDataset
vi.mock('../data/DataProvider', () => ({ useOptionalTarkovData: () => ({ data }) }))
vi.mock('../account/dataAccess', () => ({ canLoadGameData: () => true, useDataAccess: () => ({ state: 'open' }) }))

const { SupportButtons } = await import('./SupportButtons')
const { questReportHasContent, questReportPayload } = await import('./QuestReportSection')

const signedIn = { signedIn: true, email: 'player@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true }

afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop') })

describe('«Сообщить об ошибке» → «Квест»', () => {
  it('finds the quest, says what is wrong, adds a note and sends it without a description; the topic writes itself', async () => {
    const serviceRequest = vi.fn().mockResolvedValue({ id: 9, createdAt: '2026-10-13T12:00:00.000Z' })
    Object.assign(window, { tarkovDesktop: { isDesktop: true, serviceRequest, account: { status: vi.fn().mockResolvedValue(signedIn), login: vi.fn(), logout: vi.fn() } } })
    const user = userEvent.setup()
    render(<SupportButtons variant="panel" />)
    await user.click(screen.getByRole('button', { name: 'Сообщить об ошибке' }))
    await user.click(await screen.findByRole('radio', { name: 'Квест: точка, описание, условия' }))
    await user.type(screen.getByRole('textbox', { name: 'Найти квест' }), 'посыл')
    await user.click(screen.getByRole('button', { name: /Посылка из прошлого/ }))
    await user.click(screen.getByRole('radio', { name: 'Неверное описание или цель' }))
    expect(screen.getByLabelText('Тема')).toHaveValue('Квест «Посылка из прошлого»: неверное описание или цель')
    await user.type(screen.getByRole('textbox', { name: 'Заметка к квесту' }), 'Нужно найти 2 посылки')
    await user.click(screen.getByRole('button', { name: 'Отправить отчёт' }))
    expect(await screen.findByText('Спасибо! Отчёт отправлен')).toBeInTheDocument()
    // The other calls are the support chat's (the badge on «Чат с поддержкой»).
    const body = serviceRequest.mock.calls.find(([, path]) => path === '/v1/bug-reports')![2] as Record<string, unknown>
    expect(body.category).toBe('quest')
    expect(body.description).toBe('')
    expect(body.quest).toEqual({ questId: 'q-parcel', issue: 'wrong-text', mode: 'pvp', questNote: 'Нужно найти 2 посылки' })
  })

  it('a proposed place goes with its map; notes are trimmed; a point issue without anything to say is not content', () => {
    const draft = { questId: 'q', issue: 'wrong-point' as const, mapId: 'customs', markerId: 'customs-quest-zone-q-z1', goal: 'o:o1', point: { x: 100.04, z: -40.06, floor: '2 этаж' }, pointNote: '  за гаражами ', questNote: '' }
    expect(questReportPayload(draft, 'pve')).toEqual({
      questId: 'q', issue: 'wrong-point', mode: 'pve', mapId: 'customs', markerId: 'customs-quest-zone-q-z1', objectiveId: 'o1',
      point: { x: 100, z: -40.1, floor: '2 этаж' }, pointNote: 'за гаражами',
    })
    // A text issue never sends the map part, even if a place was marked before switching.
    expect(questReportPayload({ ...draft, issue: 'changed', questNote: 'Теперь на Развязке' }, 'pvp')).toEqual({ questId: 'q', issue: 'changed', mode: 'pvp', objectiveId: 'o1', questNote: 'Теперь на Развязке' })
    expect(questReportHasContent({ ...draft, markerId: undefined, point: undefined, pointNote: '' })).toBe(false)
    expect(questReportHasContent(draft)).toBe(true)
    expect(questReportHasContent(null)).toBe(false)
  })
})
