import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { BUILT_IN_PRESETS } from './screenCurve'
import type { ScreenTuningApi, ScreenTuningView } from './screenApi'
import { ScreenTuningPage } from './ScreenTuningPage'

const VIEW: ScreenTuningView = {
  settings: { presets: [], activeId: 'builtin-daylight', enabled: false, display: '', hotkey: '', cycleKey: '', builtIns: {} },
  presets: BUILT_IN_PRESETS,
  status: { available: true, gameShown: false, gameDisplay: '', displays: [String.raw`\\.\DISPLAY1`, String.raw`\\.\DISPLAY2`], exclusive: false, applied: null, editing: false, inRaid: false, on: false, keysOk: { hotkey: true, cycleKey: true }, vibrance: 50 },
  frame: null,
}

let api: { [K in keyof ScreenTuningApi]: ReturnType<typeof vi.fn> }

beforeEach(() => {
  api = {
    state: vi.fn(async () => VIEW),
    update: vi.fn(async (patch) => ({ ...VIEW, settings: { ...VIEW.settings, ...patch } })),
    savePreset: vi.fn(async () => ({ ...VIEW, savedId: 'own-1' })),
    renamePreset: vi.fn(async () => VIEW),
    deletePreset: vi.fn(async () => VIEW),
    restorePresets: vi.fn(async () => VIEW),
    revertPreset: vi.fn(async () => VIEW),
    edit: vi.fn(async () => VIEW.status),
    frame: vi.fn(async () => null),
    optimizeStatus: vi.fn(async () => ({ windows: true, onBattery: false, power: { guid: 'x', name: 'Сбалансированная', isHigh: false, highAvailable: true }, gameMode: true, backgroundRecording: true, gpuScheduling: null, heavy: [], canRevert: false, pc: null, tips: [], items: [{ id: 'gameMode', level: 'normal', title: 'Игровой режим Windows', why: 'Windows отдаёт игре больше ресурсов и не ставит обновления во время игры.', now: 'включён', done: true, available: true, recommended: false }] })),
    optimize: vi.fn(),
    revertOptimize: vi.fn(),
  }
  ;(window as unknown as { tarkovDesktop: unknown }).tarkovDesktop = { screen: api }
})

afterEach(() => {
  delete (window as unknown as { tarkovDesktop?: unknown }).tarkovDesktop
  localStorage.clear()
  setRenderLanguage('ru')
})

const renderPage = () => render(<LocaleProvider><ScreenTuningPage /></LocaleProvider>)

describe('«Настройка экрана»', () => {
  it('lists our presets, chooses one, turns it on in the game and picks the monitor', async () => {
    renderPage()
    expect(await screen.findByText('Пресет 1')).toBeInTheDocument()
    // what the presets use (owner, 08.11.2026)
    expect(screen.getByText(/цветовая таблица монитора — стандартная функция Windows — и «Цифровая интенсивность» NVIDIA. В игру не встраивается и никак с ней не взаимодействует/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Пресет 3'))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ activeId: 'builtin-owner-bright' }))
    fireEvent.click(screen.getByLabelText('Включить в игре'))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ enabled: true }))
    fireEvent.change(screen.getByLabelText('Монитор'), { target: { value: String.raw`\\.\DISPLAY2` } })
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ display: String.raw`\\.\DISPLAY2` }))
  })

  it('the curve being tuned goes into the game at once; «Сохранить пресет» asks for a name and goes back to the list', async () => {
    renderPage()
    fireEvent.click((await screen.findAllByTitle('Настроить кривую'))[4]!)
    expect(screen.getByText('NVIDIA: цифровая интенсивность')).toBeInTheDocument()
    await waitFor(() => expect(api.edit).toHaveBeenCalledWith(expect.objectContaining({ curve: expect.any(Array) })))
    fireEvent.click(screen.getByText('Сохранить пресет'))
    const name = screen.getByPlaceholderText('Название, например «Ночь на Таможне»')
    fireEvent.change(name, { target: { value: 'Ночь на Таможне' } })
    fireEvent.click(screen.getByText('Сохранить'))
    await waitFor(() => expect(api.savePreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ночь на Таможне', id: 'builtin-daylight' })))
    expect(await screen.findByText('Пресеты')).toBeInTheDocument()
    await waitFor(() => expect(api.edit).toHaveBeenLastCalledWith(null))
  })

  it('«Сбросить всё» puts the curve, the channels and every slider back', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Добавить новый пресет'))
    await waitFor(() => expect(api.edit).toHaveBeenLastCalledWith(expect.objectContaining({ id: '', curve: expect.any(Array) })))
    fireEvent.click(screen.getByText('Сбросить всё'))
    await waitFor(() => expect(api.edit).toHaveBeenLastCalledWith(expect.objectContaining({ gamma: 1, shadows: 0, contrast: 0, curve: [], haze: undefined, cast: undefined })))
  })

  it('report 179: the presets keep the order the player set (Alt + ↑ here; holding and dragging in useHoldToReorder.test.tsx)', async () => {
    const reordered = (ids: string[]) => ({ ...VIEW, presets: ids.map((id) => BUILT_IN_PRESETS.find((preset) => preset.id === id)!) })
    ;(api as Record<string, unknown>).reorderPresets = vi.fn(async (ids: string[]) => reordered(ids))
    renderPage()
    const second = await screen.findByText('Пресет 2')
    fireEvent.keyDown(second, { key: 'ArrowUp', altKey: true })
    const ids = BUILT_IN_PRESETS.map((preset) => preset.id)
    // «Без изменений» first, then «Пресет 1», «Пресет 2»…
    const expected = [ids[0]!, ids[2]!, ids[1]!, ...ids.slice(3)]
    await waitFor(() => expect(api.reorderPresets).toHaveBeenCalledWith(expected))
    await waitFor(() => expect(screen.getAllByRole('listitem').map((item) => item.textContent)[1]).toContain('Пресет 2'))
  })

  it('report 179: an older main process without the order: nothing to drag', async () => {
    renderPage()
    await screen.findByText('Пресет 2')
    expect(document.querySelector('.screen-presets')).not.toHaveClass('can-reorder')
  })

  it('binds the on/off key and the next-preset key, both not set at first (owner, 28.10.2026)', async () => {
    renderPage()
    const unset = await screen.findAllByText('Назначьте клавишу')
    expect(unset).toHaveLength(2)
    fireEvent.click(unset[0]!)
    expect(screen.getByText('Нажмите клавишу… (Esc — отмена)')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'F8', code: 'F8' })
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ hotkey: 'F8' }))
    fireEvent.click(screen.getAllByText('Назначьте клавишу')[0]!)
    fireEvent.keyDown(window, { key: 'F9', code: 'F9' })
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ cycleKey: 'F9' }))
  })

  it('«Добавить новый пресет» saves a new one under its name', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Добавить новый пресет'))
    fireEvent.click(screen.getByText('Сохранить пресет'))
    fireEvent.change(screen.getByPlaceholderText('Название, например «Ночь на Таможне»'), { target: { value: 'Мой' } })
    fireEvent.click(screen.getByText('Сохранить'))
    await waitFor(() => expect(api.savePreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'Мой', id: 'new' })))
  })

  it('renames and takes off one of ours', async () => {
    renderPage()
    await screen.findByText('Пресет 1')
    fireEvent.click(screen.getAllByTitle('Переименовать')[1]!)
    const name = screen.getByDisplayValue('Пресет 1')
    fireEvent.change(name, { target: { value: 'Кромешная ночь' } })
    fireEvent.click(screen.getByText('Сохранить'))
    await waitFor(() => expect(api.renamePreset).toHaveBeenCalledWith('builtin-owner-full-dark', 'Кромешная ночь'))
    fireEvent.click(screen.getAllByTitle('Убрать из списка')[5]!)
    await waitFor(() => expect(api.deletePreset).toHaveBeenCalledWith('builtin-daylight-rooms'))
  })

  it('is English in the English interface', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    const { container } = renderPage()
    expect(await screen.findByText('Preset 1')).toBeInTheDocument()
    expect(screen.getByText('Turn on in the game')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Add a new preset'))
    expect(container.querySelector('.screen-page')?.textContent ?? '').not.toMatch(/[А-Яа-яЁё]/)
    fireEvent.click(screen.getByText('Optimize the PC'))
    expect(await screen.findByText('Windows Game Mode')).toBeInTheDocument()
  })

  it('report 223: Windows refusing the colours is said plainly, now and after the raid', async () => {
    const on = { ...VIEW.settings, enabled: true }
    const at = new Date(2026, 10, 24, 21, 40).getTime()
    api.state.mockResolvedValueOnce({ ...VIEW, settings: on, status: { ...VIEW.status, applied: { displays: 1, strength: 0 } } })
    const first = renderPage()
    expect(await screen.findByText('Windows не дал изменить цвета монитора')).toBeInTheDocument()
    expect(screen.getByText('Выключите HDR в Windows и фильтры NVIDIA для Таркова')).toBeInTheDocument()
    expect(screen.queryByText(/0% силы/)).toBeNull()
    first.unmount()
    // one monitor: the app in front after the raid, the preset off now
    api.state.mockResolvedValueOnce({ ...VIEW, settings: on, status: { ...VIEW.status, lastRaid: { name: 'Пресет 2', strength: 0, at } } })
    const second = renderPage()
    expect(await screen.findByText('В рейде (21:40) Windows не дал изменить цвета монитора')).toBeInTheDocument()
    expect(screen.getByText('Выключите HDR в Windows и фильтры NVIDIA для Таркова')).toBeInTheDocument()
    second.unmount()
    api.state.mockResolvedValueOnce({ ...VIEW, settings: on, status: { ...VIEW.status, lastRaid: { name: 'Пресет 2', strength: 1, at } } })
    const third = renderPage()
    expect(await screen.findByText('В рейде (21:40) работал «Пресет 2»')).toBeInTheDocument()
    expect(screen.queryByText(/Выключите HDR/)).toBeNull()
    third.unmount()
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    api.state.mockResolvedValueOnce({ ...VIEW, settings: on, status: { ...VIEW.status, lastRaid: { name: 'Пресет 2', strength: 0, at } } })
    renderPage()
    expect(await screen.findByText('In the raid (21:40) Windows did not let the monitor colours change')).toBeInTheDocument()
    expect(screen.getByText('Turn off HDR in Windows and NVIDIA filters for Tarkov')).toBeInTheDocument()
  })
  it('takes the player\'s own screenshot: pasted with Ctrl+V or dropped onto the window (owner, 28.10.2026)', async () => {
    renderPage()
    expect(await screen.findByText(/Ctrl\+V или перетащите файл картинки/)).toBeInTheDocument()
    const picture = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: { files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: () => picture }] } })
    window.dispatchEvent(paste)
    expect(paste.defaultPrevented).toBe(true)
    expect(await screen.findByText('Ваш скриншот. Перетащите линию, чтобы сравнить.')).toBeInTheDocument()
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [picture], items: [] } })
    window.dispatchEvent(drop)
    // a dropped file never opens in the window instead of the app
    expect(drop.defaultPrevented).toBe(true)
  })
})

describe('«Настройка экрана»: the question marks (owner, 06.11.2026: «Да, поставь»)', () => {
  const beside = (text: string) => screen.getByText(text).closest('.setting-help-with')?.querySelector('.setting-help')

  it('every slider has one, and its name still belongs to the slider', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Добавить новый пресет'))
    for (const name of ['Тени (самое тёмное)', 'Тёмные тона', 'Светлые тона', 'Яркие (самое светлое)', 'Гамма (средние тона)', 'Тени', 'Светлые участки', 'Контраст', 'Яркость', 'Убрать дымку в темноте', 'Убрать красно-бурый налёт']) {
      const slider = screen.getByLabelText(name)
      expect(slider).toHaveAttribute('type', 'range')
      expect(slider.closest('.screen-slider')!.querySelectorAll('.setting-help')).toHaveLength(1)
    }
    fireEvent.click(screen.getByLabelText('NVIDIA: цифровая интенсивность'))
    expect(screen.getByLabelText('Насыщенность цвета')).toHaveAttribute('type', 'range')
    expect(screen.getByLabelText('NVIDIA: цифровая интенсивность').closest('.screen-slider')!.querySelectorAll('.setting-help')).toHaveLength(2)
  })

  it('every button has one, and the two keys too', async () => {
    renderPage()
    await screen.findByText('Пресет 1')
    for (const name of ['Включить в игре', 'Снимок из игры', 'Добавить новый пресет']) expect(beside(name), name).toBeTruthy()
    expect(screen.getByText('Пресеты').querySelector('.setting-help')).toBeTruthy()
    expect(screen.getByLabelText('Монитор').tagName).toBe('SELECT')
    expect(screen.getByLabelText('Монитор').parentElement!.querySelector('.setting-help')).toBeTruthy()
    for (const name of ['Вкл/выкл пресет', 'Сменить пресет']) expect(screen.getByText(name).querySelector('.setting-help'), name).toBeTruthy()
    fireEvent.click(screen.getByText('Добавить новый пресет'))
    for (const name of ['Обычная шкала', 'Сбросить всё', 'Подобрать по кадру', 'Сохранить пресет']) expect(beside(name), name).toBeTruthy()
    expect(screen.getByText('Новый пресет').querySelector('.setting-help')).toBeTruthy()
  })

  it('pressing a mark changes nothing on the page', async () => {
    renderPage()
    await screen.findByText('Пресет 1')
    fireEvent.click(beside('Включить в игре')!)
    fireEvent.click(beside('Снимок из игры')!)
    expect(api.update).not.toHaveBeenCalled()
    expect(api.frame).not.toHaveBeenCalledWith('game')
  })

  it('«Оптимизировать компьютер»: the mode, each step, the buttons and the panels', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Оптимизировать компьютер'))
    const step = (await screen.findByText('Игровой режим Windows')).closest('.optimize-item')!
    expect(step.querySelectorAll('.setting-help')).toHaveLength(1)
    expect(screen.getByRole('tablist', { name: 'Оптимизация' }).parentElement!.querySelector('.setting-help')).toBeTruthy()
    for (const name of [/^Подтвердить/, /^Отменить/, /^Вернуть как было/]) expect(screen.getByRole('button', { name }).closest('.setting-help-with')!.querySelector('.setting-help'), String(name)).toBeTruthy()
    expect(screen.getByText('Программы рядом с игрой').querySelector('.setting-help')).toBeTruthy()
    expect(screen.getByText('Ваш компьютер').querySelector('.setting-help')).toBeTruthy()
  })
})
