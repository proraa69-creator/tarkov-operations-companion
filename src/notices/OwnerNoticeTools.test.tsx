import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OwnerNoticeTools, type OwnerNoticeView } from './OwnerNoticeTools'

/**
 * The owner's «Создать объявление» / «Создать опрос» (owner, 15.10.2026), shared by the owner app and the website's admin
 * panel: what the forms send, the sent list's counts and «Отозвать».
 */
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0))
const sentNotice: OwnerNoticeView = { id: 7, kind: 'announcement', title: 'Скидка', text: 'Только сегодня', images: 1, audience: { regions: ['cis'], payment: 'paid' }, createdAt: '2026-10-15T10:00:00.000Z', targeted: 12, seen: 5, closed: 3 }
const sentSurvey: OwnerNoticeView = { id: 8, kind: 'survey', title: 'Как вам?', text: '', images: 0, questions: [], audience: { regions: [], payment: 'all' }, createdAt: '2026-10-15T11:00:00.000Z', targeted: 40, seen: 20, closed: 9, responses: 9 }

function server() {
  return vi.fn(async (method: string, path: string, body?: unknown): Promise<unknown> => {
    if (method === 'GET' && path === '/v1/accounts/me/admin/notices?kind=announcement') return { notices: [sentNotice] }
    if (method === 'GET' && path === '/v1/accounts/me/admin/notices?kind=survey') return { notices: [sentSurvey] }
    if (path === '/v1/accounts/me/admin/notices/images') return { image: { id: 'a'.repeat(24), mime: 'image/png', size: 70 } }
    if (path === '/v1/accounts/me/admin/notices' || path === '/v1/accounts/me/admin/surveys') return { notice: { ...sentNotice, id: 9, body } }
    if (path === '/v1/accounts/me/admin/notices/7/withdraw') return { notice: { ...sentNotice, withdrawnAt: '2026-10-15T12:00:00.000Z' } }
    return null
  })
}

const t = (text: string) => text
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('«Создать объявление»', () => {
  it('sends the texts, the button, the regions × payment and the uploaded photo', async () => {
    const request = server()
    const user = userEvent.setup()
    render(<OwnerNoticeTools request={request} t={t} results={() => null} />)
    await user.click(screen.getByRole('button', { name: 'Создать объявление' }))
    const form = screen.getByRole('form', { name: 'Новое объявление' })
    await user.type(within(form).getByRole('textbox', { name: 'Заголовок' }), 'Новый канал')
    await user.type(within(form).getByRole('textbox', { name: /^Текст/ }), 'Подписывайтесь')
    await user.click(within(form).getByRole('button', { name: 'Добавить английский (необязательно)' }))
    await user.type(within(form).getByRole('textbox', { name: 'Заголовок (EN)' }), 'New channel')
    await user.click(within(form).getByRole('checkbox', { name: 'Кнопка со ссылкой (например, Telegram)' }))
    await user.type(within(form).getByRole('textbox', { name: 'Текст кнопки' }), 'Telegram')
    await user.type(within(form).getByRole('textbox', { name: 'Ссылка' }), 'https://t.me/raidos')
    expect(within(form).getByRole('checkbox', { name: 'Все' })).toBeChecked()
    await user.click(within(form).getByRole('checkbox', { name: 'СНГ' }))
    await user.click(within(form).getByRole('checkbox', { name: 'Не указана' }))
    expect(within(form).getByRole('checkbox', { name: 'Все' })).not.toBeChecked()
    await user.click(within(form).getByRole('radio', { name: 'Оплатившие' }))
    expect(within(form).getByText(/Получат: СНГ, Не указана · Оплатившие/)).toBeInTheDocument()
    await user.upload(within(form).getByLabelText('Добавить фото'), new File([PNG], 'shot.png', { type: 'image/png' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/v1/accounts/me/admin/notices/images', { data: expect.stringMatching(/^iVBOR/) }))
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Отправить' })).toBeEnabled())
    await user.click(within(form).getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/v1/accounts/me/admin/notices', {
      title: 'Новый канал', text: 'Подписывайтесь', titleEn: 'New channel',
      button: { text: 'Telegram', url: 'https://t.me/raidos' },
      audience: { regions: ['cis', 'none'], payment: 'paid' },
      images: ['a'.repeat(24)],
    }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Новое объявление' })).not.toBeInTheDocument())
  }, 30_000)

  it('refuses another photo type before sending it', async () => {
    const request = server()
    const user = userEvent.setup({ applyAccept: false })
    render(<OwnerNoticeTools request={request} t={t} results={() => null} />)
    await user.click(screen.getByRole('button', { name: 'Создать объявление' }))
    await user.upload(screen.getByLabelText('Добавить фото'), new File(['GIF89a'], 'a.gif', { type: 'image/gif' }))
    await waitFor(() => expect(screen.getByTitle('Фото: только JPG, PNG или WEBP')).toBeInTheDocument())
    expect(request).not.toHaveBeenCalledWith('POST', '/v1/accounts/me/admin/notices/images', expect.anything())
  })

  it('lists the sent ones with their counts; «Отозвать» withdraws', async () => {
    const request = server()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<OwnerNoticeTools request={request} t={t} results={(id) => <a href={`#survey-${id}`}>Подробно</a>} />)
    const announcements = await screen.findByRole('region', { name: 'Отправленные объявления' })
    await within(announcements).findByText('Скидка')
    expect(within(announcements).getByText(/СНГ · Оплатившие/)).toBeInTheDocument()
    expect(within(announcements).getByText('12').parentElement).toHaveTextContent('12 получателей')
    expect(within(announcements).getByText('5').parentElement).toHaveTextContent('5 увидели')
    expect(within(announcements).getByText('3').parentElement).toHaveTextContent('3 закрыли')
    const surveys = screen.getByRole('region', { name: 'Опросы' })
    expect(await within(surveys).findByText('9')).toBeInTheDocument()
    expect(within(surveys).getByRole('link', { name: 'Подробно' })).toHaveAttribute('href', '#survey-8')
    await user.click(within(announcements).getByRole('button', { name: 'Отозвать' }))
    expect(request).toHaveBeenCalledWith('POST', '/v1/accounts/me/admin/notices/7/withdraw', {})
    expect(await within(announcements).findByText('Отозвано')).toBeInTheDocument()
  })
})

describe('«Создать опрос»', () => {
  it('builds questions: types, options, «не больше», required, reorder and delete; checks before publishing', async () => {
    const request = server()
    const user = userEvent.setup()
    render(<OwnerNoticeTools request={request} t={t} results={() => null} />)
    await user.click(screen.getByRole('button', { name: 'Создать опрос' }))
    const form = screen.getByRole('form', { name: 'Новый опрос' })
    await user.click(within(form).getByRole('button', { name: 'Опубликовать' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Введите название опроса')
    await user.type(within(form).getByRole('textbox', { name: 'Название опроса' }), 'Как вам Raid OS?')
    await user.type(within(form).getByRole('textbox', { name: 'Текст вопроса 1' }), 'Где играете?')
    await user.type(within(form).getByRole('textbox', { name: 'Вариант 1, вопрос 1' }), 'PvP')
    await user.click(within(form).getByRole('button', { name: 'Опубликовать' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Вопрос 1: нужно минимум 2 варианта')
    await user.type(within(form).getByRole('textbox', { name: 'Вариант 2, вопрос 1' }), 'PvE')

    await user.click(within(form).getByRole('button', { name: 'Добавить вопрос' }))
    await user.type(within(form).getByRole('textbox', { name: 'Текст вопроса 2' }), 'Что нравится?')
    await user.click(within(within(form).getByRole('radiogroup', { name: 'Тип ответа 2' })).getByRole('radio', { name: 'Несколько вариантов' }))
    await user.type(within(form).getByRole('textbox', { name: 'Вариант 1, вопрос 2' }), 'Карты')
    await user.type(within(form).getByRole('textbox', { name: 'Вариант 2, вопрос 2' }), 'Квесты')
    const second = within(form).getAllByRole('listitem').find((item) => item.className === 'owner-survey-question' && within(item).queryByText('Вопрос 2'))!
    await user.click(within(second).getByRole('button', { name: 'вариант' }))
    await user.type(within(form).getByRole('textbox', { name: 'Вариант 3, вопрос 2' }), 'Цены')
    await user.type(within(second).getByRole('spinbutton'), '2')
    await user.click(within(second).getByRole('checkbox', { name: 'Обязательный' }))

    await user.click(within(form).getByRole('button', { name: 'Добавить вопрос' }))
    await user.type(within(form).getByRole('textbox', { name: 'Текст вопроса 3' }), 'Удалю')
    await user.click(within(form).getByRole('button', { name: 'Удалить вопрос 3' }))
    await user.click(within(form).getByRole('button', { name: 'Добавить вопрос' }))
    await user.type(within(form).getByRole('textbox', { name: 'Текст вопроса 3' }), 'Что добавить?')
    await user.click(within(within(form).getByRole('radiogroup', { name: 'Тип ответа 3' })).getByRole('radio', { name: 'Свой ответ' }))
    // «Что добавить?» goes first.
    await user.click(within(form).getByRole('button', { name: 'Выше: 3' }))
    await user.click(within(form).getByRole('button', { name: 'Выше: 2' }))
    await user.click(within(form).getByRole('checkbox', { name: 'Европа' }))
    await user.click(within(form).getByRole('radio', { name: 'Без оплаты' }))
    await user.click(within(form).getByRole('button', { name: 'Опубликовать' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/v1/accounts/me/admin/surveys', {
      title: 'Как вам Raid OS?',
      questions: [
        { text: 'Что добавить?', type: 'text', required: true },
        { text: 'Где играете?', type: 'single', options: [{ text: 'PvP' }, { text: 'PvE' }], required: true },
        { text: 'Что нравится?', type: 'multiple', options: [{ text: 'Карты' }, { text: 'Квесты' }, { text: 'Цены' }], max: 2, required: false },
      ],
      audience: { regions: ['europe'], payment: 'unpaid' },
    }))
  }, 30_000)
})
