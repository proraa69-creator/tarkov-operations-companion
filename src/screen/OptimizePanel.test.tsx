import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { OptimizePanel } from './OptimizePanel'
import type { OptimizeItem, OptimizeStatus } from './screenApi'

const item = (patch: Partial<OptimizeItem> & Pick<OptimizeItem, 'id' | 'title'>): OptimizeItem => ({ level: 'normal', why: 'Зачем', now: 'сейчас', done: false, available: true, recommended: false, ...patch })

/** The owner's PC as the main process describes it (electron/screenTuning/optimizer.ts, pcInfo.ts). */
const STATUS: OptimizeStatus = {
  windows: true, onBattery: false, power: null, gameMode: true, backgroundRecording: true, gpuScheduling: null, heavy: [], canRevert: false,
  pc: {
    cpu: { name: 'Intel(R) Core(TM) i5-10400F CPU @ 2.90GHz', vendor: 'intel', cores: 6, threads: 12 },
    gpus: [{ name: 'NVIDIA GeForce RTX 3060 Ti', vendor: 'nvidia', driver: '617.14', driverDate: '2026-09-17' }],
    ramGb: 16, ramMhz: { rated: 3200, running: 2667, locked: true }, board: 'GALAX H410M', windows: { name: 'Windows 10 Pro', build: 19045 }, laptop: false,
    pageFile: { automatic: false, files: [{ path: 'D:\\pagefile.sys', initialMb: 32768, maxMb: 49152 }], allocatedMb: 32768 },
    game: { folder: 'C:\\Battlestate Games\\Escape from Tarkov', drive: 'C', media: 'SSD' },
  },
  items: [
    item({ id: 'power', title: 'Схема питания «Высокая производительность»', now: 'Сбалансированная', recommended: true }),
    item({ id: 'gameMode', title: 'Игровой режим Windows', now: 'включён', done: true }),
    item({ id: 'recording', title: 'Фоновая запись игры — выключить', now: 'включена', recommended: true }),
    item({ id: 'windowedGames', title: 'Оптимизации для оконных игр', available: false, reason: 'Есть только в Windows 11' }),
    item({ id: 'visualEffects', level: 'advanced', title: 'Визуальные эффекты Windows — на быстродействие', after: 'signIn' }),
    item({ id: 'gpuScheduling', level: 'advanced', title: 'Аппаратное планирование GPU', admin: true, after: 'restart' }),
  ],
  tips: [{ id: 'nvidiaApp', title: 'Настройки NVIDIA для Escape from Tarkov', text: 'Их меняет только сам игрок.', steps: ['Режим низкой задержки — Вкл.'], open: 'nvidia-app', openLabel: 'Открыть NVIDIA App' }],
}

let api: { optimizeStatus: ReturnType<typeof vi.fn>; optimize: ReturnType<typeof vi.fn>; revertOptimize: ReturnType<typeof vi.fn>; openOptimizeTool: ReturnType<typeof vi.fn> }

beforeEach(() => {
  api = {
    optimizeStatus: vi.fn(async () => STATUS),
    optimize: vi.fn(async () => ({ done: ['Схема питания: «Высокая производительность»'], skipped: [], restart: true, status: { ...STATUS, canRevert: true } })),
    revertOptimize: vi.fn(),
    openOptimizeTool: vi.fn(async () => true),
  }
  ;(window as unknown as { tarkovDesktop: unknown }).tarkovDesktop = { screen: api }
})

afterEach(() => {
  delete (window as unknown as { tarkovDesktop?: unknown }).tarkovDesktop
  localStorage.clear()
  setRenderLanguage('ru')
})

const renderPanel = () => render(<LocaleProvider><OptimizePanel /></LocaleProvider>)
const box = (name: RegExp) => screen.getByRole('checkbox', { name })

describe('«Оптимизация компьютера»: «Обычная» and «Продвинутая» with ticks, «Да» / «Нет»', () => {
  it('shows the PC, the normal steps with the recommended ones ticked, done and unavailable ones without a tick', async () => {
    renderPanel()
    expect(await screen.findByText('Intel(R) Core(TM) i5-10400F CPU @ 2.90GHz')).toBeInTheDocument()
    expect(screen.getByText(/драйвер 617\.14 от 17\.09\.2026/)).toBeInTheDocument()
    expect(screen.getByText(/2667 МГц \(модули на 3200 МГц, плата выше не даёт — это нормально\)/)).toBeInTheDocument()
    expect(box(/Схема питания/)).toBeChecked()
    expect(box(/Фоновая запись/)).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /Игровой режим/ })).toBeNull()
    expect(screen.getByText('Есть только в Windows 11')).toBeInTheDocument()
    expect(screen.queryByText('Аппаратное планирование GPU')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Продвинутая' }))
    expect(box(/Аппаратное планирование GPU/)).not.toBeChecked()
    expect(screen.getByText('Права администратора')).toBeInTheDocument()
  })

  it('«Подтвердить» asks «Да» / «Нет»: «Нет» changes nothing, «Да» applies exactly the ticked steps', async () => {
    renderPanel()
    await screen.findByText('Intel(R) Core(TM) i5-10400F CPU @ 2.90GHz')
    fireEvent.click(box(/Фоновая запись/))
    fireEvent.click(screen.getByRole('tab', { name: 'Продвинутая' }))
    fireEvent.click(box(/Аппаратное планирование GPU/))
    fireEvent.click(screen.getByRole('button', { name: /Подтвердить \(2\)/ }))
    const dialog = screen.getByRole('alertdialog', { name: 'Применить выбранное?' })
    expect(within(dialog).getByText('Аппаратное планирование GPU')).toBeInTheDocument()
    expect(within(dialog).getByText(/Windows спросит разрешение администратора/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Нет' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.optimize).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Подтвердить \(2\)/ }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Да' }))
    await waitFor(() => expect(api.optimize).toHaveBeenCalledWith(['power', 'gpuScheduling']))
    expect(await screen.findByText('Схема питания: «Высокая производительность»')).toBeInTheDocument()
    expect(screen.getByText('Перезагрузите компьютер, чтобы изменения заработали.')).toBeInTheDocument()
  })

  it('«Отменить» brings the ticks back to the recommended ones; a tip opens the video card\'s app', async () => {
    renderPanel()
    await screen.findByText('Intel(R) Core(TM) i5-10400F CPU @ 2.90GHz')
    fireEvent.click(box(/Схема питания/))
    expect(box(/Схема питания/)).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    expect(box(/Схема питания/)).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /Открыть NVIDIA App/ }))
    expect(api.openOptimizeTool).toHaveBeenCalledWith('nvidia-app')
  })

  it('English', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    renderPanel()
    expect(await screen.findByRole('tab', { name: 'Advanced' })).toBeInTheDocument()
    expect(screen.getByText('Power plan «High performance»')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirm \(2\)/ })).toBeInTheDocument()
    expect(screen.getByText('Your PC')).toBeInTheDocument()
  })
})
