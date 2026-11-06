import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { AdminNewsEditor } from './AdminNewsEditor'

const answer = (items = [{ kind: 'added', ru: 'Новая кнопка', en: 'New button' }, { kind: 'improved', ru: 'Быстрее', en: 'Faster' }], edited: string[] = []) => ({
  entries: [{ version: '0.6.0.266', date: '2026-11-06', items }],
  edited,
  edits: edited.length ? { '0.6.0.266': items } : {},
})
const flat = () => vi.fn(async (method: string) => (method === 'GET' ? answer() : answer([{ kind: 'added', ru: 'Сохранено', en: 'Saved' }], ['0.6.0.266'])))
const open = async (request: ReturnType<typeof flat>) => {
  render(<LocaleProvider><AdminNewsEditor request={request} /></LocaleProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Редактировать' }))
}
const blocks = () => [...document.querySelectorAll('.admin-news-block h4')].map((title) => title.textContent)
const points = (block: string) => within(screen.getByRole('heading', { name: block }).closest('section')!).getAllByRole('textbox') as HTMLTextAreaElement[]

afterEach(() => localStorage.clear())

// Owner, 06.11.2026: «возле них будет минус… Я нажимаю плюсик, у меня добавляется изменили… между добавили и улучшили… нажал Enter, и у меня появляется новая точка… По нажатию „Сохранить“».
describe('«Обновление» in the admin apps', () => {
  it('a release opens with its blocks, and the block that is missing comes back in its own place', async () => {
    await open(flat())
    expect(blocks()).toEqual(['Добавили', 'Улучшили'])
    fireEvent.click(screen.getByRole('button', { name: 'Изменили' }))
    expect(blocks()).toEqual(['Добавили', 'Изменили', 'Улучшили'])
    expect(screen.queryByRole('button', { name: 'Изменили' })).toBeNull()
    expect(document.activeElement).toBe(points('Изменили')[0])
  })

  it('the minus takes a block away, and its plus appears', async () => {
    await open(flat())
    fireEvent.click(screen.getByRole('button', { name: 'Убрать блок Добавили' }))
    expect(blocks()).toEqual(['Улучшили'])
    expect(screen.getByRole('button', { name: 'Добавили' })).toBeInTheDocument()
  })

  it('Enter makes the next point and stands in it, Backspace on an empty one takes it away', async () => {
    await open(flat())
    const [first] = points('Добавили')
    // What Enter leaves in a text box: a line break, on a phone's keyboard too.
    fireEvent.change(first!, { target: { value: 'Новая кнопка\n' } })
    expect(points('Добавили').map((box) => box.value)).toEqual(['Новая кнопка', ''])
    expect(document.activeElement).toBe(points('Добавили')[1])
    fireEvent.keyDown(points('Добавили')[1]!, { key: 'Backspace' })
    expect(points('Добавили').map((box) => box.value)).toEqual(['Новая кнопка'])
    // A pasted list makes a point each.
    fireEvent.change(points('Добавили')[0]!, { target: { value: 'Один\nДва\nТри' } })
    expect(points('Добавили').map((box) => box.value)).toEqual(['Один', 'Два', 'Три'])
  })

  it('«Сохранить» sends the lines in the blocks\' order, without the empty ones, and the list reads the answer', async () => {
    const request = flat()
    await open(request)
    fireEvent.click(screen.getByRole('button', { name: 'Изменили' }))
    fireEvent.change(points('Изменили')[0]!, { target: { value: '  Другая кнопка  ' } })
    fireEvent.change(points('Добавили')[0]!, { target: { value: 'Новая кнопка\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/v1/accounts/me/admin/player-news', {
      version: '0.6.0.266',
      items: [{ kind: 'added', ru: 'Новая кнопка' }, { kind: 'changed', ru: 'Другая кнопка' }, { kind: 'improved', ru: 'Быстрее' }],
    }))
    expect(await screen.findByText('Ваш текст')).toBeInTheDocument()
    expect(screen.getByText('Сохранено', { selector: '.tag' })).toBeInTheDocument()
    expect(document.querySelector('.admin-news-editor')).toBeNull()
  })

  it('a text of the owner can go back to the app\'s own; a refusal is said and the text stays', async () => {
    const request = vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'PUT') throw new Error('Проверьте текст')
      return answer(undefined, ['0.6.0.266'])
    })
    render(<LocaleProvider><AdminNewsEditor request={request} /></LocaleProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Редактировать' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте текст')
    expect(points('Добавили')[0]!.value).toBe('Новая кнопка')
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть как было' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/v1/accounts/me/admin/player-news/reset', { version: '0.6.0.266' }))
  })
})
