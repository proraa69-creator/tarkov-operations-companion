import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { BUILT_IN_PRESETS } from './screenCurve'
import type { ScreenTuningApi, ScreenTuningView } from './screenApi'
import { ScreenTuningPage } from './ScreenTuningPage'

const VIEW: ScreenTuningView = {
  settings: { presets: [], activeId: 'builtin-daylight', enabled: false, display: '', builtIns: {} },
  presets: BUILT_IN_PRESETS,
  status: { available: true, gameShown: false, gameDisplay: '', displays: [String.raw`\\.\DISPLAY1`, String.raw`\\.\DISPLAY2`], exclusive: false, applied: null, editing: false, vibrance: 50 },
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
    expect(await screen.findByText('Максимум')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Мягко'))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ activeId: 'builtin-soft' }))
    fireEvent.click(screen.getByLabelText('Включить в игре'))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ enabled: true }))
    fireEvent.change(screen.getByLabelText('Монитор'), { target: { value: String.raw`\\.\DISPLAY2` } })
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ display: String.raw`\\.\DISPLAY2` }))
  })

  it('the curve being tuned goes into the game at once; «Сохранить пресет» asks for a name and goes back to the list', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Настроить вручную'))
    expect(screen.getByText('NVIDIA: цифровая интенсивность')).toBeInTheDocument()
    await waitFor(() => expect(api.edit).toHaveBeenCalledWith(expect.objectContaining({ curve: expect.any(Array) })))
    fireEvent.click(screen.getByText('Сохранить пресет'))
    const name = screen.getByPlaceholderText('Название, например «Ночь на Таможне»')
    fireEvent.change(name, { target: { value: 'Ночь на Таможне' } })
    fireEvent.click(screen.getByText('Сохранить'))
    await waitFor(() => expect(api.savePreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ночь на Таможне', id: 'new' })))
    expect(await screen.findByText('Пресеты')).toBeInTheDocument()
    await waitFor(() => expect(api.edit).toHaveBeenLastCalledWith(null))
  })

  it('«Сбросить всё» puts the curve, the channels and every slider back', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Настроить вручную'))
    await waitFor(() => expect(api.edit).toHaveBeenLastCalledWith(expect.objectContaining({ curve: expect.any(Array) })))
    fireEvent.click(screen.getByText('Сбросить всё'))
    await waitFor(() => expect(api.edit).toHaveBeenLastCalledWith(expect.objectContaining({ gamma: 1, shadows: 0, contrast: 0, curve: [], haze: undefined, cast: undefined })))
  })

  it('renames and takes off one of ours', async () => {
    renderPage()
    await screen.findByText('Максимум')
    fireEvent.click(screen.getAllByTitle('Переименовать')[5]!)
    const name = screen.getByDisplayValue('Максимум')
    fireEvent.change(name, { target: { value: 'Кромешная ночь' } })
    fireEvent.click(screen.getByText('Сохранить'))
    await waitFor(() => expect(api.renamePreset).toHaveBeenCalledWith('builtin-max', 'Кромешная ночь'))
    fireEvent.click(screen.getAllByTitle('Убрать из списка')[6]!)
    await waitFor(() => expect(api.deletePreset).toHaveBeenCalledWith('builtin-day'))
  })

  it('is English in the English interface', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    const { container } = renderPage()
    expect(await screen.findByText('Maximum')).toBeInTheDocument()
    expect(screen.getByText('Turn on in the game')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Tune by hand'))
    expect(container.querySelector('.screen-page')?.textContent ?? '').not.toMatch(/[А-Яа-яЁё]/)
    fireEvent.click(screen.getByText('Optimize the PC'))
    expect(await screen.findByText('Windows Game Mode')).toBeInTheDocument()
  })
})
