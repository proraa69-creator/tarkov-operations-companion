import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
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

const { ReportDialog, SupportButtons } = await import('./SupportButtons')
const { questReportFromMap, questReportHasContent, questReportPayload } = await import('./QuestReportSection')

const signedIn = { signedIn: true, email: 'player@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true }

afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop') })

// Owner, 04.11.2026: «по нажатию у него в этом окне открывается именно этот квест и открывается карта с возможностью поставить
// точку и написать описание … либо это дополнительная точка, либо точка изменилась, либо не хватает точки».
describe('«Нашли неточность?» from the map\'s quest window', () => {
  const open = () => {
    const serviceRequest = vi.fn().mockResolvedValue({ id: 9, createdAt: '2026-11-04T12:00:00.000Z' })
    Object.assign(window, { tarkovDesktop: { isDesktop: true, serviceRequest, account: { status: vi.fn().mockResolvedValue(signedIn), login: vi.fn(), logout: vi.fn() } } })
    render(<ReportDialog kind="bug" quest={questReportFromMap('q-parcel', 'customs', { objectiveId: 'o1' })} onClose={() => {}} />)
    return serviceRequest
  }

  it('opens on that quest: no categories, no topic to write; what the point means; +1 день if confirmed', async () => {
    open()
    const dialog = await screen.findByRole('dialog', { name: 'Отправить отчёт об ошибке' })
    expect(dialog).toHaveTextContent('Посылка из прошлого')
    expect(dialog).toHaveTextContent('+1 день')
    expect(dialog).toHaveTextContent('Если отчёт подтвердится, к подписке добавится 1 день.')
    expect(screen.queryByRole('radio', { name: 'Квест: точка, описание, условия' })).toBeNull()
    expect(screen.queryByLabelText('Тема')).toBeNull()
    const kinds = screen.getByRole('radiogroup', { name: 'Что с точкой' })
    expect(within(kinds).getAllByRole('radio').map((entry) => entry.textContent)).toEqual(['Точка изменилась', 'Не хватает точки'])
    expect(within(kinds).getByRole('radio', { name: 'Не хватает точки' })).toHaveAttribute('aria-checked', 'true')
  })

  it('sends nothing until it says something; then the kind, the description and the topic that wrote itself', async () => {
    const serviceRequest = open()
    const user = userEvent.setup()
    await screen.findByRole('dialog', { name: 'Отправить отчёт об ошибке' })
    const send = screen.getByRole('button', { name: 'Отправить отчёт' })
    expect(send).toBeDisabled()
    // Owner, 04.11.2026: «точка изменилась, не хватает точки. И все, два пункта будет».
    expect(screen.getAllByRole('radio').map((chip) => chip.textContent)).toEqual(['Точка изменилась', 'Не хватает точки'])
    await user.click(screen.getByRole('radio', { name: 'Не хватает точки' }))
    await user.type(screen.getByRole('textbox', { name: 'Описание' }), 'Вторая посылка в подвале')
    expect(send).toBeEnabled()
    await user.click(send)
    expect(await screen.findByText('Спасибо! Отчёт отправлен')).toBeInTheDocument()
    const body = serviceRequest.mock.calls.find(([, path]) => path === '/v1/bug-reports')![2] as Record<string, unknown>
    expect(body).toMatchObject({ category: 'quest', description: '', topic: 'Квест «Посылка из прошлого»: не хватает точки' })
    expect(body.quest).toEqual({ questId: 'q-parcel', issue: 'missing-point', mode: 'pvp', mapId: 'customs', objectiveId: 'o1', questNote: 'Вторая посылка в подвале' })
  })

  it('another quest can be chosen in the same window', async () => {
    open()
    const user = userEvent.setup()
    await screen.findByRole('dialog', { name: 'Отправить отчёт об ошибке' })
    await user.click(screen.getByRole('button', { name: 'Другой квест' }))
    expect(screen.getByRole('textbox', { name: 'Найти квест' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить отчёт' })).toBeDisabled()
  })

  it('a place goes with each meaning, the old «extra-point» of an app not updated yet too; only «Точка изменилась» points at a point on the map', () => {
    const start = { ...questReportFromMap('q', 'customs', { floor: '2 этаж' }), point: { x: 1, z: 2, floor: '2 этаж' } }
    expect(start.floor).toBe('2 этаж')
    for (const issue of ['extra-point', 'missing-point', 'wrong-point'] as const) {
      expect(questReportPayload({ ...start, issue }, 'pve')).toEqual({ questId: 'q', issue, mode: 'pve', mapId: 'customs', point: { x: 1, z: 2, floor: '2 этаж' } })
    }
    expect(questReportHasContent(questReportFromMap('q', 'customs'))).toBe(false)
    expect(questReportFromMap('q', 'customs', { stageIndex: 2 }).goal).toBe('s:2')
  })
})

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
