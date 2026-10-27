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
    optimizeStatus: vi.fn(async () => ({ windows: true, onBattery: false, power: { guid: 'x', name: 'Сбалансированная', isHigh: false, highAvailable: true }, gameMode: true, backgroundRecording: true, gpuScheduling: null, heavy: [], canRevert: false })),
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
    fireEvent.click(screen.getByText('Пресет 4'))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ activeId: 'builtin-owner-bright' }))
    fireEvent.click(screen.getByLabelText('Включить в игре'))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ enabled: true }))
    fireEvent.change(screen.getByLabelText('Монитор'), { target: { value: String.raw`\\.\DISPLAY2` } })
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ display: String.raw`\\.\DISPLAY2` }))
  })

  it('the curve being tuned goes into the game at once; «Сохранить пресет» asks for a name and goes back to the list', async () => {
    renderPage()
    fireEvent.click((await screen.findAllByTitle('Настроить кривую'))[2]!)
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
    fireEvent.click(screen.getAllByTitle('Убрать из списка')[3]!)
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
})
