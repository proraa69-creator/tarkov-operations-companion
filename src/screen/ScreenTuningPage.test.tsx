import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { BUILT_IN_PRESETS } from './screenCurve'
import type { ScreenTuningApi, ScreenTuningView } from './screenApi'
import { ScreenTuningPage } from './ScreenTuningPage'

const VIEW: ScreenTuningView = {
  settings: { presets: [], activeId: 'builtin-night-soft', enabled: false, when: 'game' },
  presets: BUILT_IN_PRESETS,
  status: { available: true, gameInFront: false, exclusive: false, applied: null, trial: false, vibrance: 50 },
  frame: null,
}

let api: { [K in keyof ScreenTuningApi]: ReturnType<typeof vi.fn> }

beforeEach(() => {
  api = {
    state: vi.fn(async () => VIEW),
    update: vi.fn(async (patch) => ({ ...VIEW, settings: { ...VIEW.settings, ...patch } })),
    savePreset: vi.fn(async () => ({ ...VIEW, savedId: 'own-1' })),
    deletePreset: vi.fn(async () => VIEW),
    tryProfile: vi.fn(async () => VIEW.status),
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
  it('lists our presets, turns the chosen one on in the game and opens the manual tuning', async () => {
    renderPage()
    expect(await screen.findByText('Ночь — максимум')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Тёмные помещения'))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ activeId: 'builtin-indoors' }))
    fireEvent.click(screen.getByLabelText('Включить в игре'))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ enabled: true }))
    fireEvent.click(screen.getByText('Настроить вручную'))
    expect(screen.getByText('Гамма (средние тона)')).toBeInTheDocument()
    // NVIDIA is there: its vibrance can be added to the preset.
    expect(screen.getByText('NVIDIA: цифровая интенсивность')).toBeInTheDocument()
  })

  it('saves a hand-made preset under its name', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Настроить вручную'))
    const name = screen.getByPlaceholderText('Название, например «Ночь на Таможне»')
    fireEvent.change(name, { target: { value: 'Ночь на Таможне' } })
    fireEvent.click(screen.getByText('Сохранить пресет'))
    await waitFor(() => expect(api.savePreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ночь на Таможне', id: 'new' })))
  })

  it('is English in the English interface', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    const { container } = renderPage()
    expect(await screen.findByText('Night — maximum')).toBeInTheDocument()
    expect(screen.getByText('Turn on in the game')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Tune by hand'))
    expect(container.querySelector('.screen-page')?.textContent ?? '').not.toMatch(/[А-Яа-яЁё]/)
    fireEvent.click(screen.getByText('Optimize the PC'))
    expect(await screen.findByText('Windows Game Mode')).toBeInTheDocument()
  })
})
