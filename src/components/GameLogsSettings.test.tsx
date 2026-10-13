import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile } from '../domain/progress'
import type { ModeLogScanResult } from '../import/eftLogTimeline'

/**
 * Settings → «Журналы игры» (owner, 13.10.2026: a Steam player's nickname stayed «not found» and the app said nothing about
 * what it read): the folder, the launches read, each mode's game account, the nickname with the tarkov.dev link, «Найти
 * снова», «Выбрать папку Logs» and the report to copy.
 */
const missing = vi.hoisted(() => ({ list: [] as Array<{ mode: 'pvp' | 'pve' | 'seasonal'; accountId: number }>, retries: 0, typed: [] as string[] }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ activeProfile: createLocalProfile('Оператор'), raidMode: 'pve' }) }))
vi.mock('../account/logNickname', async (original) => ({
  ...(await original<typeof import('../account/logNickname')>()),
  useMissingNicknameAccounts: () => missing.list,
  retryNicknameLookups: async () => { missing.retries += 1; return null },
  bindTypedNickname: async (raw: string) => {
    if (!/^[a-zA-Z0-9_-]{3,15}$/.test(raw.trim())) throw new Error('Ник в игре: 3–15 символов, латиница, цифры, «_» или «-».')
    missing.typed.push(raw.trim())
    return raw.trim()
  },
}))

const { GameLogsSettings } = await import('./GameLogsSettings')
const { updateLogStatus } = await import('../import/logStatus')
const { setRenderLanguage } = await import('../i18n/renderText')

const FOLDER = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Escape from Tarkov\\build\\Logs'
const mode = (questCount: number) => ({ questCount, lastActivityAt: questCount ? '2026-10-13T10:00:00.000Z' : undefined })
const scan = {
  sessionCount: 214,
  accountIds: [5550123],
  latestAccountIdByMode: { pve: 5550123 },
  summaryByMode: { pvp: mode(0), pve: mode(37), seasonal: mode(0) },
} as unknown as ModeLogScanResult
const report = { registeredGameFolders: ['C:\\Program Files (x86)\\Steam\\steamapps\\common\\Escape from Tarkov'], steamFolders: ['C:\\Program Files (x86)\\Steam'], steamLibraries: ['C:\\Program Files (x86)\\Steam'], drivesSearched: false, folders: [{ folder: FOLDER, launches: 214, newest: 'log_2026.10.13_9-00-00_1.1.5.1' }] }

function desktop(overrides: Record<string, unknown> = {}) {
  const api = {
    autoFindAndScanLogs: vi.fn(async () => ({ ...scan, folder: FOLDER })),
    scanLogs: vi.fn(async () => ({ ...scan, folder: 'D:\\Logs' })),
    startWatchingLogs: vi.fn(async () => true),
    logSearchReport: vi.fn(async () => report),
    ...overrides,
  }
  Object.assign(window, { tarkovDesktop: api })
  return api
}

afterEach(() => {
  cleanup()
  setRenderLanguage('ru')
  missing.list = []
  missing.retries = 0
  missing.typed = []
  updateLogStatus({ folder: undefined, scan: undefined, notFound: false })
  delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
})

describe('Settings → «Журналы игры»', () => {
  it('shows what was read, the tarkov.dev link for a nickname not published yet, and the report to copy', async () => {
    desktop()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    missing.list = [{ mode: 'pve', accountId: 5550123 }]
    act(() => updateLogStatus({ folder: FOLDER, scan }))
    render(<GameLogsSettings />)
    const panel = screen.getByRole('region', { name: 'Журналы игры' })
    expect(within(panel).getByText(FOLDER)).toBeInTheDocument()
    expect(within(panel).getByText('Прочитано запусков игры: 214')).toBeInTheDocument()
    expect(within(panel).getByText('PvP: нет в журналах · PvE: аккаунт найден, заданий: 37 · Сезон: нет в журналах')).toBeInTheDocument()
    expect(within(panel).getByText('Ник: не найден')).toBeInTheDocument()

    const link = within(panel).getByRole('link', { name: 'Открыть мой профиль на tarkov.dev' })
    expect(link).toHaveAttribute('href', 'https://tarkov.dev/players/pve/5550123')
    expect(link).toHaveAttribute('target', '_blank')
    fireEvent.click(link)
    expect(within(panel).getByText('Проверяем ник каждую минуту…')).toBeInTheDocument()
    // Back in the app from the browser: asked again at once.
    fireEvent.focus(window)
    expect(missing.retries).toBe(1)

    // Or typed by hand (owner, 13.10.2026: «вернуть ручной ввод ника»).
    const typed = within(panel).getByLabelText('Или введите ник вручную')
    fireEvent.change(typed, { target: { value: 'Ник' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Сохранить ник' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Ник в игре: 3–15 символов')
    fireEvent.change(typed, { target: { value: 'Bear_Hunter' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Сохранить ник' }))
    await waitFor(() => expect(missing.typed).toEqual(['Bear_Hunter']))

    fireEvent.click(within(panel).getByRole('button', { name: 'Где искали журналы' }))
    const shown = await within(panel).findByRole('region', { name: 'Где искали журналы' })
    expect(shown.textContent).toContain(`Папка журналов: ${FOLDER}`)
    expect(shown.textContent).toContain('Steam: C:\\Program Files (x86)\\Steam')
    expect(shown.textContent).toContain('log_2026.10.13_9-00-00_1.1.5.1')
    expect(shown.textContent).not.toContain('5550123')
    fireEvent.click(within(shown).getByRole('button', { name: 'Скопировать отчёт' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('PvE: аккаунт найден, заданий: 37')))
  })

  it('«Найти снова» without a result says so and opens the report; «Выбрать папку Logs» reads the picked folder', async () => {
    const api = desktop({ autoFindAndScanLogs: vi.fn(async () => null) })
    render(<GameLogsSettings />)
    const panel = screen.getByRole('region', { name: 'Журналы игры' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Найти снова' }))
    expect(await within(panel).findByText(/Папка Logs не найдена\. Выберите её/)).toBeInTheDocument()
    expect(await within(panel).findByRole('region', { name: 'Где искали журналы' })).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: 'Выбрать папку Logs' }))
    expect(await within(panel).findByText('D:\\Logs')).toBeInTheDocument()
    expect(api.startWatchingLogs).toHaveBeenCalledWith('D:\\Logs')
    expect(localStorage.getItem('tarkov-operations-log-folder-v1')).toBe('D:\\Logs')
  })

  it('speaks English and stays out of the server laptop and the browser', () => {
    setRenderLanguage('en')
    desktop()
    act(() => updateLogStatus({ folder: FOLDER, scan }))
    render(<GameLogsSettings />)
    expect(screen.getByRole('region', { name: 'Game logs' })).toBeInTheDocument()
    expect(screen.getByText('Game launches read: 214')).toBeInTheDocument()
    expect(screen.getByText('PvP: not in the logs · PvE: account found, tasks: 37 · Season: not in the logs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find again' })).toBeInTheDocument()
    cleanup()
    Object.assign(window, { tarkovDesktop: { ...window.tarkovDesktop, serverMode: true } })
    const { container } = render(<GameLogsSettings />)
    expect(container).toBeEmptyDOMElement()
    cleanup()
    delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
    expect(render(<GameLogsSettings />).container).toBeEmptyDOMElement()
  })
})
