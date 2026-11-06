import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDataset } from '../domain/types'
import type { OwnerChatThread, OwnerReport } from '../data/ownerRequests'

/**
 * «Отчёты» (owner app, owner 05.11.2026): the one table; under «Подробнее» what a report could do before (owner 13.10.2026):
 * agreeing quest corrections grouped, the owner applies, grants days, answers, opens the chat.
 */
const data = {
  quests: [{ id: 'q1', name: 'Посылка из прошлого', trader: 'Прапор', description: '', level: 5, kappa: false, rewards: [], objectives: [] }],
  maps: [{ id: 'customs', name: 'Таможня' }], markers: [],
} as unknown as AppDataset
vi.mock('../data/DataProvider', () => ({ useOptionalTarkovData: () => ({ data }) }))

const { RequestsPage, groupQuestReports } = await import('./RequestsPage')
const { RequestsNavButton } = await import('../components/RequestsNavButton')

const quest = (id: number, x: number, z: number, extra: Partial<OwnerReport> = {}): OwnerReport => ({
  id, kind: 'bug', category: 'quest', topic: 'Квест «Посылка из прошлого»: точка стоит не там', appVersion: '0.6.0-28 · client', platform: 'Windows',
  status: 'open', createdAt: `2026-10-13T1${id}:00:00.000Z`, files: 0, rewardDays: 0, email: `p${id}@mail.ru`, matches: 2, group: 'point:q1:customs:0',
  quest: { questId: 'q1', issue: 'wrong-point', mode: 'pvp', mapId: 'customs', markerId: 'customs-quest-zone-q1-z1', objectiveId: 'o1', point: { x, z }, pointNote: `заметка ${id}` },
  ...extra,
})
const bug: OwnerReport = { id: 7, kind: 'bug', category: 'map', topic: 'Карта не открывается', appVersion: '0.6.0-28 · client', platform: 'Windows', status: 'open', createdAt: '2026-10-13T09:00:00.000Z', files: 0, rewardDays: 0, email: 'bug@mail.ru' }

afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(window, 'tarkovDesktop') })

const PLAYER = 'a1b2c3d4e5f6a1b2c3d4e5f6'
const chat = (unread: number): OwnerChatThread => ({
  accountId: PLAYER, email: 'p1@mail.ru', nickname: 'Shturman_77', unread, lastAt: '2026-10-13T10:00:00.000Z',
  lastMessage: { id: 2, author: 'user', text: 'Карта Таможни не грузится', createdAt: '2026-10-13T10:00:00.000Z', read: false },
})

/** The server's answer for the table: the reports with their text and status. */
const tableOf = (reports: OwnerReport[]) => ({
  rows: reports.map((report) => ({ description: 'Текст игрока', work: { status: 'review' }, ...report })),
  total: reports.length,
  counts: { active: reports.length, closed: 0, awaiting: reports.length },
  agentSeenAt: new Date().toISOString(),
})
/** The row of a report in the table. */
const rowOf = async (title: string) => (await screen.findAllByText(title))[0]!.closest('tr') as HTMLElement
/** Opens «Подробнее» on the row of a report; the row itself holds the rest. */
async function detailsOf(user: ReturnType<typeof userEvent.setup>, title: string, name = 'Подробнее') {
  const row = await rowOf(title)
  await user.click(within(row).getByRole('button', { name }))
  return row.querySelector('.rt-detail') as HTMLElement
}
const QUEST_TOPIC = 'Квест «Посылка из прошлого»: точка стоит не там'

/** `more`: answers for the paths a test adds (undefined: the common answers below). */
function ownerApp(reports: OwnerReport[], edition: 'owner' | 'client' = 'owner', chats: OwnerChatThread[] = [], more?: (method: string, path: string, body?: unknown) => unknown) {
  const calls: Array<[string, string, unknown]> = []
  const serviceRequest = vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push([method, path, body])
    const answer = more?.(method, path, body)
    if (answer !== undefined) return answer
    if (path.startsWith('/v1/accounts/me/admin/bug-reports/table?view=active')) return tableOf(reports)
    if (path.startsWith('/v1/accounts/me/admin/bug-reports/table?view=closed')) return tableOf([])
    if (path.startsWith('/v1/accounts/me/admin/requests/events')) return path.includes('since') ? new Promise(() => {}) : { version: 5, open: reports.length, ...(chats.length ? { unreadChats: chats.filter((entry) => entry.unread).length } : {}) }
    // «Чаты» (server/src/routes/supportChat.ts)
    if (path.startsWith('/v1/accounts/me/admin/support/threads?')) return { threads: chats, total: chats.length, unread: chats.filter((entry) => entry.unread).length }
    if (path === `/v1/accounts/me/admin/support/threads/${PLAYER}`) {
      return { account: { id: PLAYER, email: 'p1@mail.ru', nickname: 'Shturman_77' }, messages: [
        { id: 1, author: 'user', text: 'Здравствуйте!', createdAt: '2026-10-13T09:59:00.000Z', read: false },
        { id: 2, author: 'user', text: 'Карта Таможни не грузится', createdAt: '2026-10-13T10:00:00.000Z', read: false },
      ] }
    }
    if (method === 'POST' && path === `/v1/accounts/me/admin/support/threads/${PLAYER}/messages`) return { message: { id: 3, author: 'owner', text: (body as { text: string }).text, createdAt: '2026-10-13T10:05:00.000Z', read: false } }
    if (method === 'POST' && path === `/v1/accounts/me/admin/support/threads/${PLAYER}/read`) return null
    if (path === '/v1/accounts/me/admin/quest-points') return { overrides: [] }
    return { report: reports[0] }
  })
  Object.assign(window, { tarkovDesktop: { edition, isDesktop: true, serviceRequest, account: { status: vi.fn().mockResolvedValue({ signedIn: true, email: 'owner@raidos.app', online: true, serverUrl: 'https://raidos.app', persistent: true }) } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/requests']}>
        <RequestsNavButton locale="ru" />
        <Routes>
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/maps/:mapId" element={<p>map page</p>} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { calls, view }
}

describe('«Отчёты»', () => {
  it('groups the agreeing corrections with the average place, the most agreed first', () => {
    const groups = groupQuestReports([quest(1, 100, -40), quest(2, 108, -36), quest(3, 160, -40, { matches: 1, group: 'point:q1:customs:1' }), bug])
    expect(groups.map((group) => [group.key, group.matches, group.point])).toEqual([
      ['point:q1:customs:0', 2, { x: 104, z: -38 }], ['point:q1:customs:1', 1, { x: 160, z: -40 }],
    ])
    expect(groups[0]).toMatchObject({ questId: 'q1', issue: 'wrong-point', mapId: 'customs', markerId: 'customs-quest-zone-q1-z1', objectiveId: 'o1' })
  })

  it('the sidebar button shows what waits for the owner, in the owner app only', async () => {
    ownerApp([quest(1, 100, -40), quest(2, 108, -36), bug])
    const nav = await screen.findByRole('navigation', { name: 'Отчёты' })
    expect(within(nav).getByRole('link', { name: /Отчёты/ })).toHaveAttribute('href', '/requests')
    expect(await within(nav).findByLabelText('Ожидающих отчётов: 3')).toHaveTextContent('3')
    cleanup()
    ownerApp([bug], 'client')
    expect(screen.queryByRole('navigation', { name: 'Отчёты' })).toBeNull()
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('one table of every kind: a number, the kind, the title, the text, who wrote it', async () => {
    const idea: OwnerReport = { ...bug, id: 8, kind: 'idea', topic: 'Таймер рейда' }
    ownerApp([idea, { ...bug, nickname: 'Ник_Игрока' } as OwnerReport])
    const row = await rowOf('Таймер рейда')
    expect(within(row).getByText('8')).toBeInTheDocument()
    expect(within(row).getByText('Предложение')).toBeInTheDocument()
    expect(within(await rowOf('Карта не открывается')).getByText('Отчёт')).toBeInTheDocument()
    const line = await rowOf('Карта не открывается')
    for (const fact of ['bug@mail.ru', 'Ник_Игрока', '0.6.0-28 · client', 'Windows']) expect(within(line).getByText(fact)).toBeInTheDocument()
    expect(screen.queryByText('Ожидает проверки')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Отдать в работу' })).toBeNull()
    expect(screen.getByRole('tablist', { name: 'Отчёты' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Ошибки/ })).toBeNull()
  })

  it('with a server before the table it says the table waits for the update; the chats still work', async () => {
    ownerApp([], 'owner', [chat(1)], (_method, path) => {
      if (path.includes('/bug-reports/table')) throw new Error('Отчёт не найден')
      return undefined
    })
    expect(await screen.findByText('Таблица заработает после обновления сервера.', undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Чаты/ })).toBeInTheDocument()
  })

  it('«Копировать» carries the report\'s data: e-mail, system, version', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    ownerApp([bug])
    await user.click(within(await rowOf('Карта не открывается')).getByRole('button', { name: 'Копировать' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0]![0]
    for (const part of ['Отчёт №7', 'Почта: bug@mail.ru', 'Windows: Windows', 'Версия приложения: 0.6.0-28 · client', 'Тема: Карта не открывается', 'Текст игрока']) expect(text).toContain(part)
  })

  it('«Взял в работу» and «Готово»: three lists, the row goes from one to the next; the owner\'s work starts no Claude', async () => {
    const { calls } = ownerApp([bug], 'owner', [], (_method, path) => (path.includes('view=working') ? tableOf([{ ...bug, id: 11, topic: 'Делаю сам', work: { status: 'taken' } } as OwnerReport]) : undefined))
    const user = userEvent.setup()
    const line = await rowOf('Карта не открывается')
    expect(within(line).getAllByRole('button').map((button) => button.textContent)).toEqual(['Взял в работу', 'Уже реализовано', 'Отменить', 'Копировать', 'Подробнее'])
    const reads = calls.filter(([method, path]) => method === 'GET' && path.includes('/table?')).length
    await user.click(within(line).getByRole('button', { name: 'Взял в работу' }))
    await waitFor(() => expect(calls.filter(([, path]) => path.endsWith('/work')).map(([, path, body]) => [path, body])).toEqual([['/v1/accounts/me/admin/bug-reports/7/work', { action: 'take' }]]))
    await waitFor(() => expect(calls.filter(([method, path]) => method === 'GET' && path.includes('/table?')).length).toBeGreaterThan(reads))

    await user.click(screen.getByRole('button', { name: /^В процессе/ }))
    const taken = await rowOf('Делаю сам')
    expect(within(taken).getAllByRole('button').map((button) => button.textContent)).toEqual(['Готово', 'Вернуть в активные', 'Копировать', 'Подробнее'])
    await user.click(within(taken).getByRole('button', { name: 'Готово' }))
    await waitFor(() => expect(calls.filter(([, path]) => path.endsWith('/work')).map(([, , body]) => body)).toContainEqual({ action: 'implemented' }))
  })

  it('«Подробнее» grows the row itself: no second line under it, and the whole text shows', async () => {
    ownerApp([{ ...bug, accountId: PLAYER } as OwnerReport])
    const user = userEvent.setup()
    const row = await rowOf('Карта не открывается')
    const rows = row.parentElement!.children.length
    expect(row.querySelector('.rt-text')).toHaveClass('is-folded')
    const details = await detailsOf(user, 'Карта не открывается')
    expect(within(details).getByRole('button', { name: 'Ответить' })).toBeInTheDocument()
    expect(row.parentElement!.children.length).toBe(rows)
    expect(row.querySelector('.rt-text')).not.toHaveClass('is-folded')
  })

  it('«Перенести точку сюда» moves the wrong point to the agreed place for everybody and closes the requests; days go to every sender', async () => {
    const { calls } = ownerApp([quest(1, 100, -40), quest(2, 108, -36), bug])
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await detailsOf(user, QUEST_TOPIC)
    expect(await screen.findByRole('heading', { name: 'Посылка из прошлого' })).toBeInTheDocument()
    expect(screen.getByText('Совпадает у 2')).toBeInTheDocument()
    expect(screen.getByText('К точке: заметка 1', { exact: false })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Начислить дни' }))
    await waitFor(() => expect(calls.filter(([, path]) => path.endsWith('/reward')).map(([, path, body]) => [path, body])).toEqual([
      ['/v1/accounts/me/admin/bug-reports/1/reward', { days: 1 }], ['/v1/accounts/me/admin/bug-reports/2/reward', { days: 1 }],
    ]))

    await user.click(screen.getByRole('button', { name: 'Перенести точку сюда' }))
    await waitFor(() => expect(calls.some(([method, path]) => method === 'PUT' && path === '/v1/accounts/me/admin/quest-points')).toBe(true))
    expect(calls.find(([method]) => method === 'PUT')![2]).toEqual({ questId: 'q1', markerId: 'customs-quest-zone-q1-z1', mapId: 'customs', x: 104, z: -38, kind: 'move', objectiveId: 'o1', note: 'По заявкам №1, №2' })
    await waitFor(() => expect(calls.filter(([, path]) => path.endsWith('/work')).map(([, path, body]) => [path, body])).toEqual([
      ['/v1/accounts/me/admin/bug-reports/1/work', { action: 'already' }], ['/v1/accounts/me/admin/bug-reports/2/work', { action: 'already' }],
    ]))
    expect(await screen.findByText('Точка применена, отчёты закрыты')).toBeInTheDocument()
  })

  it('the «Отчёты» badge counts what waits for the owner and the chats with unread messages', async () => {
    ownerApp([bug], 'owner', [chat(2)])
    const nav = await screen.findByRole('navigation', { name: 'Отчёты' })
    expect(await within(nav).findByLabelText('Ожидающих отчётов: 2')).toHaveTextContent('2')
  })

  it('«Чаты»: the conversations with the unread ones counted; opening one shows it, marks it read, and the owner answers (owner, 13.10.2026)', async () => {
    const { calls } = ownerApp([], 'owner', [chat(2)])
    const user = userEvent.setup()
    const tab = await screen.findByRole('tab', { name: /Чаты/ })
    await waitFor(() => expect(tab).toHaveTextContent('Чаты1'))
    await user.click(tab)
    const thread = await screen.findByRole('button', { name: /Shturman_77/ })
    expect(thread).toHaveTextContent('Карта Таможни не грузится')
    expect(within(thread).getByLabelText('Непрочитанных: 2')).toBeInTheDocument()
    expect(screen.getByText('Выберите переписку слева.')).toBeInTheDocument()

    await user.click(thread)
    const view = await screen.findByRole('region', { name: 'Shturman_77' })
    expect(within(view).getByText('p1@mail.ru')).toBeInTheDocument()
    const first = await within(view).findByText('Здравствуйте!')
    // The player's messages on the left: they are not the owner's own.
    expect(first.closest('.support-chat-message')).not.toHaveClass('is-own')
    await waitFor(() => expect(calls.some(([method, path]) => method === 'POST' && path === `/v1/accounts/me/admin/support/threads/${PLAYER}/read`)).toBe(true))

    const box = within(view).getByRole('textbox', { name: 'Сообщение' })
    expect(box).toHaveAttribute('placeholder', 'Ответ игроку…')
    await user.type(box, 'Добрый день! Уже чиним.{Enter}')
    await waitFor(() => expect(calls.filter(([method, path]) => method === 'POST' && path.endsWith('/messages')).map(([, path, body]) => [path, body])).toEqual([
      [`/v1/accounts/me/admin/support/threads/${PLAYER}/messages`, { text: 'Добрый день! Уже чиним.' }],
    ]))
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('«Открыть в конструкторе» opens the quest on its map with the agreed place', async () => {
    ownerApp([quest(1, 100, -40), quest(2, 108, -36), bug])
    const user = userEvent.setup()
    const details = await detailsOf(user, QUEST_TOPIC)
    await user.click(within(details).getByRole('button', { name: 'Открыть в конструкторе' }))
    expect(await screen.findByText('map page')).toBeInTheDocument()
  })
})

/** Owner, 04.11.2026: «если я отвечаю на какую-то ошибку, на заявку, или на предложение, прям там могу ответить, не открывая чат». */
describe('«Ответить» on a report', () => {
  const posted = (calls: Array<[string, string, unknown]>) => calls.filter(([method, path]) => method === 'POST' && path.endsWith('/messages')).map(([, path, body]) => [path, body])

  it('answers from the card, without opening the chat: the player\'s chat gets the report\'s number with the words', async () => {
    const { calls } = ownerApp([{ ...bug, accountId: PLAYER } as OwnerReport])
    const user = userEvent.setup()
    const card = await detailsOf(user, 'Карта не открывается')
    await user.click(within(card).getByRole('button', { name: 'Ответить' }))
    // What the player will see above the words.
    expect(card.querySelector('.support-chat-report')).toHaveTextContent('Ответ на заявку №7Карта не открывается')
    await user.type(within(card).getByRole('textbox', { name: 'Сообщение' }), 'Какая карта?{Enter}')
    await waitFor(() => expect(posted(calls)).toEqual([[`/v1/accounts/me/admin/support/threads/${PLAYER}/messages`, { text: 'Какая карта?', reportId: 7 }]]))
    expect(await within(card).findByRole('status')).toHaveTextContent('Ответ отправлен')
    expect(within(card).queryByRole('textbox', { name: 'Сообщение' })).toBeNull()
    // Still on the table, and nothing moved.
    expect(screen.getByRole('tab', { name: /Отчёты/ })).toHaveAttribute('aria-selected', 'true')
    expect(calls.some(([method, path]) => method === 'POST' && path.endsWith('/work'))).toBe(false)
  })

  // Owner, 04.11.2026: «Показывать на заявке метку „Отвечено“» — «Да, добавить».
  it('«Отвечено» on the card once the server says so, read again after the answer; none before it', async () => {
    let answeredAt: string | undefined
    const { calls } = ownerApp([{ ...bug, accountId: PLAYER } as OwnerReport], 'owner', [], (method, path) => {
      if (method === 'POST' && path.endsWith('/messages')) { answeredAt = '2026-11-04T10:00:00.000Z'; return undefined }
      if (path.startsWith('/v1/accounts/me/admin/bug-reports/table?view=active')) return tableOf([{ ...bug, accountId: PLAYER, ...(answeredAt ? { answeredAt } : {}) } as OwnerReport])
      return undefined
    })
    const user = userEvent.setup()
    await detailsOf(user, 'Карта не открывается')
    const card = () => document.querySelector('.rt-detail') as HTMLElement
    expect(within(card()).queryByText('Отвечено')).toBeNull()
    await user.click(within(card()).getByRole('button', { name: 'Ответить' }))
    await user.type(within(card()).getByRole('textbox', { name: 'Сообщение' }), 'Какая карта?{Enter}')
    expect(await within(card()).findByText('Отвечено')).toBeInTheDocument()
    // The mark says it now, without a second line beside it.
    expect(within(card()).queryByRole('status')).toBeNull()
    expect(calls.filter(([method, path]) => method === 'GET' && path.includes('bug-reports/table?view=active')).length).toBeGreaterThan(1)
  })

  it('on a quest correction\'s line too', async () => {
    ownerApp([{ ...quest(1, 100, -40), accountId: PLAYER, answeredAt: '2026-11-04T10:00:00.000Z' } as OwnerReport, { ...quest(2, 108, -36), accountId: PLAYER } as OwnerReport])
    await detailsOf(userEvent.setup(), QUEST_TOPIC)
    const answered = (await screen.findByText('К точке: заметка 1')).closest('li')!
    expect(within(answered).getByText('Отвечено')).toBeInTheDocument()
    expect(within(screen.getByText('К точке: заметка 2').closest('li')!).queryByText('Отвечено')).toBeNull()
  })

  it('on each player\'s line of a quest correction, about that player\'s own report', async () => {
    const SECOND = 'b1b2c3d4e5f6b1b2c3d4e5f6'
    const { calls } = ownerApp([{ ...quest(1, 100, -40), accountId: PLAYER } as OwnerReport, { ...quest(2, 108, -36), accountId: SECOND } as OwnerReport])
    const user = userEvent.setup()
    await detailsOf(user, QUEST_TOPIC)
    const line = (await screen.findByText('К точке: заметка 2')).closest('li')!
    await user.click(within(line).getByRole('button', { name: 'Ответить' }))
    await user.type(within(line).getByRole('textbox', { name: 'Сообщение' }), 'Спасибо{Enter}')
    await waitFor(() => expect(posted(calls)).toEqual([[`/v1/accounts/me/admin/support/threads/${SECOND}/messages`, { text: 'Спасибо', reportId: 2 }]]))
  })

  it('a refused answer stays in the box with the reason; a report of a deleted account has no «Ответить»', async () => {
    ownerApp([{ ...bug, accountId: PLAYER } as OwnerReport, { ...bug, id: 8, topic: 'Старый отчёт' }], 'owner', [], (method, path) => {
      if (method === 'POST' && path.endsWith('/messages')) throw new Error('Заявка не найдена')
      return undefined
    })
    const user = userEvent.setup()
    expect(within(await detailsOf(user, 'Старый отчёт')).queryByRole('button', { name: 'Ответить' })).toBeNull()
    const card = await detailsOf(user, 'Карта не открывается')
    await user.click(within(card).getByRole('button', { name: 'Ответить' }))
    await user.type(within(card).getByRole('textbox', { name: 'Сообщение' }), 'Ответ{Enter}')
    expect(await within(card).findByRole('alert')).toHaveTextContent('Заявка не найдена')
    expect(within(card).getByRole('textbox', { name: 'Сообщение' })).toHaveValue('Ответ')
  })
})

/** Owner, 14.10.2026: «где я отметил добавь открыть чат и туда можно будет писать». */
describe('«Открыть чат» on a report', () => {
  const SILENT = 'b1b2c3d4e5f6b1b2c3d4e5f6'
  const silentThread = (method: string, path: string) => (method === 'GET' && path === `/v1/accounts/me/admin/support/threads/${SILENT}` ? { account: { id: SILENT, email: 'bug@mail.ru' }, messages: [] } : undefined)
  const withAuthor = <T extends OwnerReport>(report: T, accountId: string) => ({ ...report, accountId }) as T

  it('«Чаты» with the author\'s conversation open, even one never written to; the owner writes first', async () => {
    const { calls } = ownerApp([withAuthor(bug, SILENT)], 'owner', [chat(1)], silentThread)
    const user = userEvent.setup()
    const card = await detailsOf(user, 'Карта не открывается')
    await user.click(within(card).getByRole('button', { name: 'Открыть чат' }))
    expect(screen.getByRole('tab', { name: /Чаты/ })).toHaveAttribute('aria-selected', 'true')
    const view = await screen.findByRole('region', { name: 'bug@mail.ru' })
    expect(await within(view).findByText('Сообщений пока нет.')).toBeInTheDocument()
    // Nothing to delete yet; the other conversations stay in the list.
    expect(within(view).queryByRole('button', { name: 'Проблема решена' })).toBeNull()
    expect(screen.getByRole('button', { name: /Shturman_77/ })).toBeInTheDocument()
    await user.type(within(view).getByRole('textbox', { name: 'Сообщение' }), 'Здравствуйте! Какая карта не открывается?{Enter}')
    await waitFor(() => expect(calls.filter(([method, path]) => method === 'POST' && path.endsWith('/messages')).map(([, path, body]) => [path, body])).toEqual([
      [`/v1/accounts/me/admin/support/threads/${SILENT}/messages`, { text: 'Здравствуйте! Какая карта не открывается?' }],
    ]))
    // Opening it read nothing as seen and closed no report.
    expect(calls.some(([method, path]) => method === 'POST' && (path.endsWith('/read') || path.endsWith('/work')))).toBe(false)
  })

  it('ideas and closed reports too; a report of a deleted account has no chat button', async () => {
    const base = { appVersion: '0.6.0-28 · client', platform: 'Windows', createdAt: '2026-10-13T09:00:00.000Z', files: 0, rewardDays: 0 }
    const idea: OwnerReport = { ...base, id: 8, kind: 'idea', topic: 'Таймер рейда', status: 'open', email: 'idea@mail.ru' }
    const gone: OwnerReport = { ...base, id: 9, kind: 'bug', topic: 'Старый отчёт', status: 'open' }
    const closed = { ...base, id: 10, kind: 'bug', topic: 'Уже исправлено', status: 'closed', email: 'closed@mail.ru', work: { status: 'rejected' } } as OwnerReport
    ownerApp([withAuthor(idea, SILENT), gone], 'owner', [], (_method, path) => (path.startsWith('/v1/accounts/me/admin/bug-reports/table?view=closed') ? tableOf([withAuthor(closed, SILENT)]) : undefined))
    const user = userEvent.setup()
    expect(within(await detailsOf(user, 'Таймер рейда')).getByRole('button', { name: 'Открыть чат' })).toBeInTheDocument()
    const card = await detailsOf(user, 'Старый отчёт')
    expect(await rowOf('Старый отчёт')).toHaveTextContent('аккаунт удалён')
    expect(within(card).queryByRole('button', { name: 'Открыть чат' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Закрытые/ }))
    const row = await rowOf('Уже исправлено')
    expect(within(row).getByText('Отменено')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Вернуть в активные' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Взял в работу' })).toBeNull()
    expect(within(await detailsOf(user, 'Уже исправлено')).getByRole('button', { name: 'Открыть чат' })).toBeInTheDocument()
  })

  it('a quest correction: under the actions for one player, on each player\'s line for several', async () => {
    const OTHER = 'c1c2c3d4e5f6c1c2c3d4e5f6'
    const { view } = ownerApp([withAuthor(quest(1, 100, -40), PLAYER), withAuthor(quest(2, 108, -36), OTHER)])
    const user = userEvent.setup()
    const group = await detailsOf(user, QUEST_TOPIC)
    const lines = within(group).getAllByRole('listitem')
    expect(lines.map((line) => within(line).queryByRole('button', { name: 'Открыть чат' }) !== null)).toEqual([true, true])
    const actions = group.querySelector('.requests-actions') as HTMLElement
    expect(within(actions).queryByRole('button', { name: 'Открыть чат' })).toBeNull()
    await user.click(within(lines[1]!).getByRole('button', { name: 'Открыть чат' }))
    expect(screen.getByRole('tab', { name: /Чаты/ })).toHaveAttribute('aria-selected', 'true')
    view.unmount()

    ownerApp([withAuthor(quest(1, 100, -40), PLAYER), withAuthor(quest(2, 108, -36), PLAYER)])
    const one = await detailsOf(user, QUEST_TOPIC)
    expect(within(one).getAllByRole('button', { name: 'Открыть чат' })).toHaveLength(1)
    expect(within(one.querySelector('.requests-actions') as HTMLElement).getByRole('button', { name: 'Открыть чат' })).toBeInTheDocument()
    await user.click(within(one).getByRole('button', { name: 'Открыть чат' }))
    expect(await screen.findByRole('region', { name: 'Shturman_77' })).toBeInTheDocument()
  })
})

/** Owner, 14.10.2026: «добавь кнопку у админ версии, проблема решена. и данный чат удаляется». */
describe('«Проблема решена»', () => {
  it('asks «Удалить переписку?»; «Нет» keeps it, «Да» deletes the whole conversation and leaves the report open', async () => {
    let deleted = false
    const { calls } = ownerApp([bug], 'owner', [chat(0)], (method, path) => {
      if (method === 'DELETE') { deleted = true; return null }
      if (deleted && path.startsWith('/v1/accounts/me/admin/support/threads?')) return { threads: [], total: 0, unread: 0 }
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /Чаты/ }))
    await user.click(await screen.findByRole('button', { name: /Shturman_77/ }))
    const view = await screen.findByRole('region', { name: 'Shturman_77' })
    await within(view).findByText('Здравствуйте!')
    const resolve = within(view).getByRole('button', { name: 'Проблема решена' })

    await user.click(resolve)
    expect(within(view).getByText('Удалить переписку?')).toBeInTheDocument()
    expect(within(view).getByRole('button', { name: 'Нет' })).toHaveFocus()
    await user.click(within(view).getByRole('button', { name: 'Нет' }))
    expect(within(view).queryByText('Удалить переписку?')).toBeNull()
    expect(within(view).getByRole('button', { name: 'Проблема решена' })).toHaveFocus()
    // Escape says «Нет» too.
    await user.click(within(view).getByRole('button', { name: 'Проблема решена' }))
    await user.keyboard('{Escape}')
    expect(within(view).queryByText('Удалить переписку?')).toBeNull()
    expect(calls.some(([method]) => method === 'DELETE')).toBe(false)

    await user.click(within(view).getByRole('button', { name: 'Проблема решена' }))
    await user.click(within(view).getByRole('button', { name: 'Да' }))
    await waitFor(() => expect(calls.filter(([method]) => method === 'DELETE').map(([, path]) => path)).toEqual([`/v1/accounts/me/admin/support/threads/${PLAYER}`]))
    expect(await screen.findByText('Выберите переписку слева.')).toBeInTheDocument()
    expect(await screen.findByText('Переписок пока нет.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Shturman_77' })).toBeNull()
    // The report's status stays the owner's own decision.
    expect(calls.some(([, path]) => path.endsWith('/work'))).toBe(false)
  })

  it('a refusal stays in the conversation with the reason', async () => {
    ownerApp([], 'owner', [chat(0)], (method) => {
      if (method === 'DELETE') throw new Error("Error invoking remote method 'service:request': Error: Слишком много запросов. Подождите минуту.")
      return undefined
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /Чаты/ }))
    await user.click(await screen.findByRole('button', { name: /Shturman_77/ }))
    const view = await screen.findByRole('region', { name: 'Shturman_77' })
    await within(view).findByText('Здравствуйте!')
    await user.click(within(view).getByRole('button', { name: 'Проблема решена' }))
    await user.click(within(view).getByRole('button', { name: 'Да' }))
    expect(await within(view).findByRole('alert')).toHaveTextContent('Слишком много запросов. Подождите минуту.')
    expect(within(view).getByText('Здравствуйте!')).toBeInTheDocument()
  })
})

describe('«Чаты» with screenshots (owner, 15.10.2026: «еще связаться с поддержкой, добавь что бы можно было добавить скриншот»)', () => {
  const SHOT = 'feedface0000feedface0000'
  const withShots = (method: string, path: string) => {
    if (method === 'GET' && path === `/v1/accounts/me/admin/support/threads/${PLAYER}`) {
      return { account: { id: PLAYER, email: 'p1@mail.ru', nickname: 'Shturman_77' }, messages: [
        { id: 1, author: 'user', text: 'Вот что вижу', createdAt: '2026-10-13T09:59:00.000Z', read: false, attachments: [{ id: SHOT, width: 1280, height: 720 }] },
        { id: 2, author: 'user', text: '[скриншот]', createdAt: '2026-10-13T10:00:00.000Z', read: false, attachments: [{ id: `${SHOT.slice(0, 23)}1`, width: 640, height: 480 }] },
      ] }
    }
    if (method === 'GET' && path.startsWith('/v1/accounts/me/admin/support/attachments/')) return { mime: 'image/jpeg', data: '/9j/4AAQ', width: 1280, height: 720 }
    return undefined
  }
  const shotChat: OwnerChatThread = { ...chat(1), lastMessage: { id: 2, author: 'user', text: '[скриншот]', createdAt: '2026-10-13T10:00:00.000Z', read: false, attachments: [{ id: `${SHOT.slice(0, 23)}1`, width: 640, height: 480 }] } }

  it('the list says «[скриншот]»; the conversation shows the players\' screenshots from the owner\'s route; a click opens them full size', async () => {
    const { calls } = ownerApp([], 'owner', [shotChat], withShots)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /Чаты/ }))
    const thread = await screen.findByRole('button', { name: /Shturman_77/ })
    expect(thread).toHaveTextContent('[скриншот]')
    await user.click(thread)
    const view = await screen.findByRole('region', { name: 'Shturman_77' })
    const withText = (await within(view).findByText('Вот что вижу')).closest('.support-chat-message') as HTMLElement
    expect(await within(withText).findByRole('img', { name: 'Скриншот 1' })).toHaveAttribute('src', 'data:image/jpeg;base64,/9j/4AAQ')
    // Screenshots only: the images, no «[скриншот]» in the bubble.
    const only = view.querySelectorAll('.support-chat-message')[1] as HTMLElement
    expect(await within(only).findByRole('img', { name: 'Скриншот 1' })).toBeInTheDocument()
    expect(only).not.toHaveTextContent('[скриншот]')
    const reads = calls.filter(([, path]) => path.includes('/attachments/')).map(([, path]) => path)
    expect(reads.sort()).toEqual([`/v1/accounts/me/admin/support/attachments/${SHOT}`, `/v1/accounts/me/admin/support/attachments/${SHOT.slice(0, 23)}1`].sort())
    await user.click(within(withText).getByRole('button', { name: 'Открыть скриншот 1' }))
    expect(await screen.findByRole('dialog', { name: 'Изображение 1 из 1' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Изображение/ })).toBeNull()
  })

  it('the owner attaches a screenshot to an answer with the same box', async () => {
    const { calls } = ownerApp([], 'owner', [chat(1)])
    const user = userEvent.setup({ applyAccept: false })
    await user.click(await screen.findByRole('tab', { name: /Чаты/ }))
    await user.click(await screen.findByRole('button', { name: /Shturman_77/ }))
    const view = await screen.findByRole('region', { name: 'Shturman_77' })
    await user.upload(within(view).getByLabelText('Скриншоты'), new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])], 'fix.jpg', { type: 'image/jpeg' }))
    expect(await within(view).findByRole('img', { name: 'fix.jpg' })).toBeInTheDocument()
    await user.type(within(view).getByRole('textbox', { name: 'Сообщение' }), 'Вот так{Enter}')
    await waitFor(() => expect(calls.filter(([method, path]) => method === 'POST' && path.endsWith('/messages')).map(([, path, body]) => [path, body])).toEqual([
      [`/v1/accounts/me/admin/support/threads/${PLAYER}/messages`, { text: 'Вот так', images: [{ data: '/9j/4A==' }] }],
    ]))
  })
})

/** Owner, 14.10.2026: «еще добавь возможность открывать скриншоты которые люди присылают». */
describe('a report\'s images full size', () => {
  const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const withImages = (method: string, path: string) => {
    if (method !== 'GET') return undefined
    if (path === '/v1/accounts/me/admin/bug-reports/7') return { report: { ...bug, files: [{ idx: 0, mime: 'image/png', size: 70 }, { idx: 1, mime: 'image/jpeg', size: 70 }], description: 'Чёрный экран' } }
    const file = /\/files\/(\d)\/data$/.exec(path)
    return file ? { mime: file[1] === '0' ? 'image/png' : 'image/jpeg', data: `${PIXEL}${file[1]}` } : undefined
  }

  it('a thumbnail right in the row opens them over the app; ←/→ and the buttons go through them; Esc, «×» or a click outside close', async () => {
    const { calls } = ownerApp([{ ...bug, files: 2 }], 'owner', [], withImages)
    const user = userEvent.setup()
    await screen.findByRole('img', { name: 'Скриншот 2' })
    const first = screen.getAllByRole('button', { name: /Открыть изображение/ })[0]!
    await user.click(first)
    const viewer = await screen.findByRole('dialog', { name: 'Изображение 1 из 2' })
    // Over the app (in <body>), the image from the owner-only route as a data URL.
    expect(viewer.parentElement).toBe(document.body)
    expect(viewer).toHaveAttribute('aria-modal', 'true')
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', `data:image/png;base64,${PIXEL}0`)
    expect(calls.filter(([, path]) => path.includes('/files/')).map(([, path]) => path)).toEqual([
      '/v1/accounts/me/admin/bug-reports/7/files/0/data', '/v1/accounts/me/admin/bug-reports/7/files/1/data',
    ])
    expect(within(viewer).getByRole('button', { name: 'Закрыть' })).toHaveFocus()
    expect(viewer).toHaveTextContent('1 / 2')

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'Изображение 2 из 2' })).toBeInTheDocument()
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', `data:image/jpeg;base64,${PIXEL}1`)
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'Изображение 1 из 2' })).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('dialog', { name: 'Изображение 2 из 2' })).toBeInTheDocument()
    await user.click(within(viewer).getByRole('button', { name: 'Предыдущее изображение' }))
    expect(screen.getByRole('dialog', { name: 'Изображение 1 из 2' })).toBeInTheDocument()
    await user.click(within(viewer).getByRole('button', { name: 'Следующее изображение' }))
    expect(screen.getByRole('dialog', { name: 'Изображение 2 из 2' })).toBeInTheDocument()
    // The focus stays in the viewer: Tab goes round its three buttons.
    within(viewer).getByRole('button', { name: 'Закрыть' }).focus()
    await user.tab()
    expect(within(viewer).getByRole('button', { name: 'Предыдущее изображение' })).toHaveFocus()
    await user.tab()
    await user.tab()
    expect(within(viewer).getByRole('button', { name: 'Закрыть' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(viewer).getByRole('button', { name: 'Следующее изображение' })).toHaveFocus()
    // Esc closes it and gives the focus back.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(first).toHaveFocus()

    // The second one opens on itself; a click on the image keeps it, outside closes.
    const thumbnails = screen.getAllByRole('button', { name: /Открыть изображение/ })
    expect(thumbnails).toHaveLength(2)
    await user.click(thumbnails[1]!)
    const second = await screen.findByRole('dialog', { name: 'Изображение 2 из 2' })
    fireEvent.mouseDown(within(second).getByRole('img'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.mouseDown(second)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(thumbnails[1]).toHaveFocus()
    await user.click(thumbnails[0]!)
    await user.click(within(await screen.findByRole('dialog', { name: 'Изображение 1 из 2' })).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // Read once.
    expect(calls.filter(([, path]) => path.includes('/files/'))).toHaveLength(2)
  })

  it('one image: no steps, the arrows do nothing', async () => {
    ownerApp([{ ...bug, files: 1 }], 'owner', [], (method, path) => {
      if (path === '/v1/accounts/me/admin/bug-reports/7') return { report: { ...bug, files: [{ idx: 0, mime: 'image/png', size: 70 }], description: '' } }
      return withImages(method, path)
    })
    const user = userEvent.setup()
    await detailsOf(user, 'Карта не открывается')
    await user.click((await screen.findAllByRole('button', { name: /Открыть изображение/ }))[0]!)
    const viewer = await screen.findByRole('dialog', { name: 'Изображение 1 из 1' })
    expect(within(viewer).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Закрыть'])
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'Изображение 1 из 1' })).toBeInTheDocument()
  })
})

describe('English', () => {
  it('has English for «Открыть чат», «Проблема решена» and the image viewer', async () => {
    const { setRenderLanguage, uiText } = await import('../i18n/renderText')
    setRenderLanguage('en')
    try {
      expect(uiText('Открыть чат')).toBe('Open chat')
      expect(uiText('Проблема решена')).toBe('Problem solved')
      expect(uiText('Удалить переписку?')).toBe('Delete the conversation?')
      expect([uiText('Да'), uiText('Нет')]).toEqual(['Yes', 'No'])
      expect(uiText('Открыть изображение')).toBe('Open image')
      expect(uiText('Открыть во весь размер')).toBe('Open full size')
      expect(uiText('Предыдущее изображение')).toBe('Previous image')
      expect(uiText('Следующее изображение')).toBe('Next image')
      expect(`${uiText('Изображение')} 2 ${uiText('из')} 3`).toBe('Image 2 of 3')
      expect(uiText('изображений')).toBe('images')
      ownerApp([{ ...bug, accountId: PLAYER } as OwnerReport], 'owner', [chat(0)])
      const user = userEvent.setup()
      expect(await screen.findByRole('columnheader', { name: 'Author' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^In progress/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Taking it' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Already implemented' })).toBeInTheDocument()
      await detailsOf(user, 'Карта не открывается', 'Details')
      await user.click(screen.getByRole('button', { name: 'Open chat' }))
      const view = await screen.findByRole('region', { name: 'Shturman_77' })
      await within(view).findByText('Здравствуйте!')
      await user.click(within(view).getByRole('button', { name: 'Problem solved' }))
      expect(within(view).getByText('Delete the conversation?')).toBeInTheDocument()
      expect(within(view).getByRole('button', { name: 'Yes' })).toBeInTheDocument()
      expect(within(view).getByRole('button', { name: 'No' })).toBeInTheDocument()
    } finally {
      setRenderLanguage('ru')
    }
  })
})
