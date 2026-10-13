import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile } from '../domain/progress'
import type { ModeLogScanResult } from '../import/eftLogTimeline'

/**
 * Settings → «Журналы игры» (owner, 13.10.2026: a Steam player's nickname stayed «not found» and the app said nothing about
 * what it read): the folder, the launches read, each mode's game account, the nickname with «Сменить ник», «Найти снова»,
 * «Выбрать папку Logs» and the report to copy.
 */
const nick = vi.hoisted(() => ({ current: undefined as string | undefined, typed: [] as string[] }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ activeProfile: createLocalProfile('Оператор'), raidMode: 'pve' }) }))
vi.mock('../account/useAccountNickname', () => ({ useAccountNickname: () => nick.current }))
vi.mock('../account/logNickname', async (original) => ({
  ...(await original<typeof import('../account/logNickname')>()),
  useLogAccounts: () => ({ pve: 5550123 }),
  setTypedNickname: async (raw: string) => {
    if (!/^[a-zA-Z0-9_-]{3,15}$/.test(raw.trim())) throw new Error('Ник в игре: 3–15 символов, латиница, цифры, «_» или «-».')
    nick.typed.push(raw.trim())
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
  nick.current = undefined
  nick.typed = []
  updateLogStatus({ folder: undefined, scan: undefined, notFound: false })
  delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
})

describe('Settings → «Журналы игры»', () => {
  it('shows what was read, the tarkov.dev link for a nickname not published yet, and the report to copy', async () => {
    desktop()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    act(() => updateLogStatus({ folder: FOLDER, scan }))
    render(<GameLogsSettings />)
    const panel = screen.getByRole('region', { name: 'Журналы игры' })
    expect(within(panel).getByText(FOLDER)).toBeInTheDocument()
    expect(within(panel).getByText('Прочитано запусков игры: 214')).toBeInTheDocument()
    expect(within(panel).getByText('PvP: нет в журналах · PvE: аккаунт найден, заданий: 37 · Сезон: нет в журналах')).toBeInTheDocument()
    expect(within(panel).getByText('Ник: не указан')).toBeInTheDocument()
    expect(within(panel).queryByRole('link')).toBeNull()

    // The nickname comes from the game's screen by itself; typing it is the fallback behind «Указать вручную».
    expect(within(panel).getByText(/Ник и уровень появятся сами/)).toBeInTheDocument()
    expect(within(panel).queryByLabelText('Ник в игре')).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'Указать вручную' }))
    expect(within(panel).getByText(/привяжется к аккаунту игры из логов этого компьютера/)).toBeInTheDocument()
    const typed = within(panel).getByLabelText('Ник в игре')
    fireEvent.change(typed, { target: { value: 'Ник' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Сохранить ник' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Ник в игре: 3–15 символов')
    fireEvent.change(typed, { target: { value: 'Bear_Hunter' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Сохранить ник' }))
    await waitFor(() => expect(nick.typed).toEqual(['Bear_Hunter']))

    fireEvent.click(within(panel).getByRole('button', { name: 'Где искали журналы' }))
    const shown = await within(panel).findByRole('region', { name: 'Где искали журналы' })
    expect(shown.textContent).toContain(`Папка журналов: ${FOLDER}`)
    expect(shown.textContent).toContain('Steam: C:\\Program Files (x86)\\Steam')
    expect(shown.textContent).toContain('log_2026.10.13_9-00-00_1.1.5.1')
    expect(shown.textContent).not.toContain('5550123')
    fireEvent.click(within(shown).getByRole('button', { name: 'Скопировать отчёт' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('PvE: аккаунт найден, заданий: 37')))
  })

  it('«Сменить ник» opens the field with the nickname, «Отмена» closes it', async () => {
    desktop()
    nick.current = 'Bear_Hunter'
    render(<GameLogsSettings />)
    const panel = screen.getByRole('region', { name: 'Журналы игры' })
    expect(within(panel).getByText('Ник: Bear_Hunter')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Сменить ник' }))
    expect(within(panel).getByLabelText('Ник в игре')).toHaveValue('Bear_Hunter')
    expect(within(panel).getByLabelText('Ник в игре')).toHaveFocus()
    fireEvent.click(within(panel).getByRole('button', { name: 'Отмена' }))
    expect(within(panel).queryByLabelText('Ник в игре')).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'Сменить ник' }))
    fireEvent.change(within(panel).getByLabelText('Ник в игре'), { target: { value: 'Wolf_77' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Сохранить ник' }))
    await waitFor(() => expect(nick.typed).toEqual(['Wolf_77']))
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
