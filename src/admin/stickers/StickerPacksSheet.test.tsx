import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminStickerPack } from '../adminApi'

const mocks = vi.hoisted(() => ({
  stickerPacks: vi.fn(), createStickerPack: vi.fn(), updateStickerPack: vi.fn(), deleteStickerPack: vi.fn(), orderStickerPacks: vi.fn(),
  addSticker: vi.fn(), orderStickers: vi.fn(), deleteSticker: vi.fn(),
}))
vi.mock('../adminApi', async (load) => ({ ...(await load<typeof import('../adminApi')>()), adminApi: mocks }))
// The editor draws on a canvas jsdom does not have: «Сохранить» hands over a PNG's base64 at once.
vi.mock('./StickerEditor', () => ({
  StickerEditor: ({ onSave, onCancel }: { onSave: (png: string) => Promise<void>; onCancel: () => void }) => <div role="dialog" aria-label="Новый стикер">
    <button type="button" onClick={() => void onSave('iVBORw0KGgo=').catch(() => {})}>Сохранить</button>
    <button type="button" onClick={onCancel}>Отмена</button>
  </div>,
}))

const { StickerPacksSheet } = await import('./StickerPacksSheet')

/** «Стикеры» of the iPhone admin (owner, 07.11.2026: «И там я буду делать паки стикеров. Которые по нажатию кнопки добавить…»). */
const at = '2026-11-08T10:00:00.000Z'
const sticker = (id: string) => ({ id, width: 512, height: 512, size: 20_000 })
const pack = (id: string, name: string, change: Partial<AdminStickerPack> = {}): AdminStickerPack => ({ id, name, published: false, createdAt: at, updatedAt: at, stickers: [], ...change })
const MEMES = 'a1'.repeat(12)
const DRAFT = 'b2'.repeat(12)
const FIRST = 'c3'.repeat(12)
const SECOND = 'd4'.repeat(12)

describe('«Стикеры» of the iPhone admin', () => {
  let packs: AdminStickerPack[]
  beforeEach(() => {
    vi.clearAllMocks()
    packs = [pack(MEMES, 'Мемы', { published: true, stickers: [sticker(FIRST), sticker(SECOND)] }), pack(DRAFT, 'Черновик')]
    const answer = () => ({ packs: packs.map((entry) => ({ ...entry, stickers: [...entry.stickers] })) })
    mocks.stickerPacks.mockImplementation(async () => answer())
    mocks.createStickerPack.mockImplementation(async (name: string) => {
      const created = pack('e5'.repeat(12), name)
      packs = [...packs, created]
      return { pack: created, ...answer() }
    })
    mocks.updateStickerPack.mockImplementation(async (id: string, change: { name?: string; published?: boolean }) => {
      packs = packs.map((entry) => (entry.id === id ? { ...entry, ...change } : entry))
      return answer()
    })
    mocks.deleteStickerPack.mockImplementation(async (id: string) => { packs = packs.filter((entry) => entry.id !== id); return answer() })
    mocks.orderStickerPacks.mockImplementation(async (ids: string[]) => { packs = ids.map((id) => packs.find((entry) => entry.id === id)!); return answer() })
    mocks.addSticker.mockImplementation(async (id: string) => {
      const added = sticker('f6'.repeat(12))
      packs = packs.map((entry) => (entry.id === id ? { ...entry, stickers: [...entry.stickers, added] } : entry))
      return { sticker: added, ...answer() }
    })
    mocks.orderStickers.mockImplementation(async (id: string, ids: string[]) => {
      packs = packs.map((entry) => (entry.id === id ? { ...entry, stickers: ids.map((one) => entry.stickers.find((known) => known.id === one)!) } : entry))
      return answer()
    })
    mocks.deleteSticker.mockImplementation(async (id: string) => { packs = packs.map((entry) => ({ ...entry, stickers: entry.stickers.filter((one) => one.id !== id) })); return answer() })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('lists the packs with their state, makes a new one and opens it, orders them', async () => {
    const user = userEvent.setup()
    render(<StickerPacksSheet onClose={() => {}} />)
    const sheet = await screen.findByRole('dialog', { name: 'Стикеры' })
    const rows = await within(sheet).findAllByRole('button', { name: /Стикеров:/ })
    expect(rows.map((row) => row.textContent)).toEqual(['МемыСтикеров: 2В приложениях', 'ЧерновикСтикеров: 0Не добавлен'])
    expect(rows[0]!.querySelector('img')).toHaveAttribute('src', `https://raidos.app/v1/stickers/${FIRST}.png`)

    await user.click(within(sheet).getByRole('button', { name: 'Ниже: Мемы' }))
    expect(mocks.orderStickerPacks).toHaveBeenCalledWith([DRAFT, MEMES])
    await waitFor(() => expect(within(sheet).getAllByRole('button', { name: /Стикеров:/ })[0]).toHaveTextContent('Черновик'))
    expect(within(sheet).getByRole('button', { name: 'Выше: Черновик' })).toBeDisabled()

    const name = within(sheet).getByRole('textbox', { name: 'Название пака' })
    expect(within(sheet).getByRole('button', { name: 'Создать' })).toBeDisabled()
    await user.type(name, 'Новый пак{Enter}')
    expect(mocks.createStickerPack).toHaveBeenCalledWith('Новый пак')
    // Made: it opens, not yet in the apps.
    const opened = await screen.findByRole('dialog', { name: 'Новый пак' })
    expect(within(opened).getByRole('button', { name: 'Добавить' })).toBeInTheDocument()
    expect(within(opened).getByText('Стикеров пока нет')).toBeInTheDocument()
  })

  it('a pack: «Добавить» / «Убрать», a new sticker from the editor, order and delete stickers, rename and delete the pack', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<StickerPacksSheet onClose={() => {}} />)
    await user.click(await screen.findByRole('button', { name: /^Черновик/ }))
    let view = await screen.findByRole('dialog', { name: 'Черновик' })

    // A new sticker: the editor's PNG goes to this pack.
    await user.click(within(view).getByRole('button', { name: 'Новый стикер' }))
    const editor = await screen.findByRole('dialog', { name: 'Новый стикер' })
    await user.click(within(editor).getByRole('button', { name: 'Сохранить' }))
    expect(mocks.addSticker).toHaveBeenCalledWith(DRAFT, 'iVBORw0KGgo=')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый стикер' })).toBeNull())
    expect(within(view).getByRole('status')).toHaveTextContent('Стикер сохранён')
    expect(within(view).getAllByRole('option')).toHaveLength(1)

    // «Добавить»: every app's picker shows it; «Убрать» takes it back.
    await user.click(within(view).getByRole('button', { name: 'Добавить' }))
    expect(mocks.updateStickerPack).toHaveBeenLastCalledWith(DRAFT, { published: true })
    expect(await within(view).findByText('Пак добавлен в приложения')).toBeInTheDocument()
    expect(within(view).getByText('Игроки видят пак на ПК и телефоне')).toBeInTheDocument()
    await user.click(within(view).getByRole('button', { name: 'Убрать' }))
    expect(mocks.updateStickerPack).toHaveBeenLastCalledWith(DRAFT, { published: false })
    expect(await within(view).findByText('Пак убран из приложений')).toBeInTheDocument()

    // Rename.
    await user.click(within(view).getByRole('button', { name: 'Переименовать' }))
    const input = within(view).getByRole('textbox', { name: 'Название пака' })
    await user.clear(input)
    await user.type(input, 'Рейд{Enter}')
    expect(mocks.updateStickerPack).toHaveBeenLastCalledWith(DRAFT, { name: 'Рейд' })
    view = await screen.findByRole('dialog', { name: 'Рейд' })

    // Delete the pack: asked first, then back to the list.
    await user.click(within(view).getByRole('button', { name: 'Удалить пак' }))
    expect(confirm).toHaveBeenLastCalledWith('Удалить пак «Рейд» со всеми стикерами?')
    expect(mocks.deleteStickerPack).toHaveBeenCalledWith(DRAFT)
    const list = await screen.findByRole('dialog', { name: 'Стикеры' })
    expect(within(list).getAllByRole('button', { name: /Стикеров:/ })).toHaveLength(1)

    // Another pack's stickers: chosen, moved, deleted.
    await user.click(within(list).getByRole('button', { name: /^Мемы/ }))
    view = await screen.findByRole('dialog', { name: 'Мемы' })
    await user.click(within(view).getByRole('option', { name: 'Стикер 2' }))
    await user.click(within(view).getByRole('button', { name: 'Левее' }))
    expect(mocks.orderStickers).toHaveBeenCalledWith(MEMES, [SECOND, FIRST])
    await waitFor(() => expect(within(view).getAllByRole('option')[0]!.querySelector('img')).toHaveAttribute('src', `https://raidos.app/v1/stickers/${SECOND}.png`))
    await user.click(within(view).getByRole('button', { name: 'Удалить' }))
    expect(confirm).toHaveBeenLastCalledWith('Удалить стикер?')
    expect(mocks.deleteSticker).toHaveBeenCalledWith(SECOND)
    await waitFor(() => expect(within(view).getAllByRole('option')).toHaveLength(1))
  })

  it('a refused upload keeps the editor open; the server\'s reason shows', async () => {
    const user = userEvent.setup()
    mocks.addSticker.mockRejectedValue(new Error('Стикер больше 512 КБ'))
    render(<StickerPacksSheet onClose={() => {}} />)
    await user.click(await screen.findByRole('button', { name: /^Мемы/ }))
    const view = await screen.findByRole('dialog', { name: 'Мемы' })
    await user.click(within(view).getByRole('button', { name: 'Новый стикер' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Новый стикер' })).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(mocks.addSticker).toHaveBeenCalled())
    expect(screen.getByRole('dialog', { name: 'Новый стикер' })).toBeInTheDocument()
    expect(within(view).getAllByRole('option')).toHaveLength(2)
  })

  it('English for «Стикеры», the editor and the server\'s refusals; the owner\'s pack names stay as written', async () => {
    const { setRenderLanguage, uiText } = await import('../../i18n/renderText')
    setRenderLanguage('en')
    try {
      for (const [ru, en] of [
        ['Стикеры', 'Stickers'], ['Паки для чата на ПК и телефоне', 'Packs for the chat on PC and phone'], ['Название пака', 'Pack name'], ['Создать', 'Create'],
        ['Стикеров: 3', 'Stickers: 3'], ['В приложениях', 'In the apps'], ['Не добавлен', 'Not added'], ['Добавить', 'Add'], ['Убрать', 'Remove'],
        ['Новый стикер', 'New sticker'], ['Выбрать фото', 'Choose a photo'], ['Вырезаем персонажа…', 'Cutting out the character…'], ['Двигать', 'Move'],
        ['Стереть', 'Erase'], ['Вернуть', 'Restore'], ['Текст', 'Text'], ['Кисть', 'Brush'], ['Обводка', 'Outline'], ['Шрифт', 'Font'], ['Тень', 'Shadow'],
        ['Сверху', 'Top'], ['Снизу', 'Bottom'], ['Где угодно', 'Anywhere'], ['Сохранить', 'Save'], ['Удалить стикер?', 'Delete the sticker?'],
        ['Человека не нашли — сотрите фон кистью', 'No person found: erase the background with the brush'],
        ['Название пака — от 1 до 40 символов', 'A pack name has 1 to 40 characters'], ['В паке не больше 120 стикеров', 'No more than 120 stickers in a pack'],
      ]) expect(uiText(ru!)).toBe(en)
      expect(uiText('Удалить пак «Мемы» со всеми стикерами?')).toBe('Delete pack «Мемы» with all its stickers?')
      expect(uiText('Выше: Мемы')).toBe('Up: Мемы')
    } finally {
      setRenderLanguage('ru')
    }
  })

  it('no answer from the server: says why and asks again on «Повторить»', async () => {
    const user = userEvent.setup()
    mocks.stickerPacks.mockRejectedValueOnce(new Error('Сервер недоступен'))
    render(<StickerPacksSheet onClose={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер недоступен')
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('button', { name: /^Мемы/ })).toBeInTheDocument()
  })
})
