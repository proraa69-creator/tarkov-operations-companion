import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentalPage, MINIMAP_OFF_NOTICE } from './ExperimentalPage'
import { PositionSetupNotice } from '../overlay/PositionSetupCard'
import { reloadRemoteFeaturesForTests, setRemoteFeatures } from '../announcement/features'
import { checkAnnouncementNow } from '../announcement/announcement'
import { SUPPORT_TELEGRAM_URL } from '../app/support'
import { setRenderLanguage } from '../i18n/renderText'

vi.mock('../announcement/announcement', async (importOriginal) => ({
  ...await importOriginal<typeof import('../announcement/announcement')>(),
  checkAnnouncementNow: vi.fn(() => Promise.resolve()),
}))

// The owner's minimap switch for every app (owner, 14.10.2026: «по кнопке выключить в реальном времени должны исчезать
// зачеркнутые блоки»; src/announcement/features.ts).
const settings = { minimap: true, minimapOff: false, minimapOpacity: 0.9, minimapWidth: 420, playerMarker: 'arrow', itemKey: 'Semicolon', minimapKey: 'KeyM', collectorKey: '', screenshotsDir: '', runAsAdmin: false }
const status = { screenshotKey: { keys: ['M'], source: 'game-settings', unbound: false, label: 'M' }, minimapKey: 'KeyM', otherKeys: ['Semicolon'], elevated: true, screenshotsFolder: 'screenshots', nativeError: '', gameKeys: 'visible', lastPosition: null }
// «Скриншот» not bound in the game: the position card on «Обзор» has something to say.
const unbound = { ...status, screenshotKey: { keys: [], source: 'game-settings', unbound: true, label: '' } }
const api = { getSettings: vi.fn(), getStatus: vi.fn(), updateSettings: vi.fn(), toggleMinimap: vi.fn(), pickScreenshotsFolder: vi.fn(), relaunchAsAdmin: vi.fn() }
const serviceRequest = vi.fn()

/** The crossed-out blocks of the owner's screenshot (and the player's own «Отключить мини-карту»). */
const MINIMAP_BLOCKS = [
  'Точка на мини-карте', 'Безрамочный', 'Прозрачность мини-карты', 'Обозначение игрока', 'Клавиша мини-карты', 'Размер мини-карты',
  'Папка со скриншотами', 'Выбрать папку со скриншотами', 'Определить автоматически', 'Показать / скрыть мини-карту', 'Клавиша скриншота в игре',
  'Отключить мини-карту',
]
const KEPT = ['Клавиша информации о предмете', 'Клавиша сканирования предметов для коллекционера', 'Запускать от имени администратора']
const shown = (text: string) => document.body.textContent?.includes(text) ?? false

function desktop(edition: 'owner' | 'client' = 'client') {
  vi.stubGlobal('tarkovDesktop', { edition, experimental: api, serviceRequest })
}

beforeEach(() => {
  setRenderLanguage('ru')
  desktop()
  api.getSettings.mockResolvedValue(settings)
  api.getStatus.mockResolvedValue(status)
  api.updateSettings.mockImplementation(async (patch) => ({ ...settings, ...patch }))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  reloadRemoteFeaturesForTests()
  setRenderLanguage('ru')
})

const page = async () => {
  render(<ExperimentalPage />)
  await screen.findByText('Клавиша информации о предмете')
  await waitFor(() => expect(api.getStatus).toHaveBeenCalled())
}
const switchTo = (minimap: boolean, minimapChangedAt = '') => act(() => { setRemoteFeatures({ minimap, minimapChangedAt }) })
const dismissNotice = () => fireEvent.click(screen.getByRole('button', { name: 'Понятно' }))

describe('the Mini Map page follows the owner\'s switch', () => {
  it('not known yet (a first start before the server answers): the minimap blocks are not drawn, and no notice', async () => {
    await page()
    for (const text of MINIMAP_BLOCKS) expect(shown(text), text).toBe(false)
    for (const text of KEPT) expect(shown(text), text).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('off: the blocks disappear, not greyed out; on: they show as before; it changes live', async () => {
    switchTo(false)
    await page()
    dismissNotice()
    for (const text of MINIMAP_BLOCKS) expect(shown(text), text).toBe(false)
    for (const text of KEPT) expect(shown(text), text).toBe(true)

    switchTo(true)
    await screen.findByText('Точка на мини-карте готова')
    for (const text of MINIMAP_BLOCKS) expect(shown(text), text).toBe(true)
    expect(screen.getByRole('slider', { name: 'Размер мини-карты' })).toBeEnabled()

    switchTo(false, '2026-10-15T10:00:00.000Z')
    for (const text of MINIMAP_BLOCKS) expect(shown(text), text).toBe(false)
    for (const text of KEPT) expect(shown(text), text).toBe(true)
  })

  it('asks the server again as the page opens', async () => {
    await page()
    expect(checkAnnouncementNow).toHaveBeenCalled()
  })

  it('the one-time notice: once per installation, again only after the minimap went on and off again', async () => {
    switchTo(false)
    await page()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(MINIMAP_OFF_NOTICE)
    expect(screen.getByRole('link', { name: 'Telegram' })).toHaveAttribute('href', SUPPORT_TELEGRAM_URL)
    expect(screen.getByRole('link', { name: 'Telegram' })).toHaveAttribute('target', '_blank')
    dismissNotice()
    expect(screen.queryByRole('dialog')).toBeNull()

    // The page opened again, the app started again (the switch read back from this installation): not again.
    cleanup()
    reloadRemoteFeaturesForTests()
    await page()
    expect(screen.queryByRole('dialog')).toBeNull()

    // The owner turned it on, then off again: once more.
    switchTo(true, '')
    expect(screen.queryByRole('dialog')).toBeNull()
    switchTo(false, '2026-10-16T09:00:00.000Z')
    expect(await screen.findByRole('dialog')).toHaveTextContent('Ожидаем официального ответа от BSG!')
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the notice in English', async () => {
    setRenderLanguage('en')
    switchTo(false)
    render(<ExperimentalPage />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('The minimap feature is temporarily turned off, for our users\' peace of mind. We are waiting for an official answer from BSG. Thank you for understanding! If you have questions, ask us on Telegram.')
    expect(screen.getByRole('link', { name: 'Telegram' })).toHaveAttribute('href', SUPPORT_TELEGRAM_URL)
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('Item info key')).toBeInTheDocument()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(shown('Mini map key')).toBe(false)
    expect(shown('Mini map size')).toBe(false)
  })
})

describe('the owner\'s button', () => {
  it('players never see it', async () => {
    switchTo(true)
    await page()
    expect(shown('Функции мини-карты (окно поверх игры и отслеживание)')).toBe(false)
    expect(screen.queryByRole('button', { name: /для всех/ })).toBeNull()
  })

  it('the owner edition: the state and one button; the page follows at once', async () => {
    desktop('owner')
    switchTo(false)
    serviceRequest.mockImplementation(async (_method: string, _path: string, body: { minimap: boolean }) => ({
      features: { minimap: body.minimap, minimapChangedAt: body.minimap ? null : '2026-10-15T12:00:00.000Z', updatedBy: 'owner@example.com', updatedAt: '2026-10-15T12:00:00.000Z' },
    }))
    await page()
    dismissNotice()
    const card = screen.getByRole('region', { name: 'Функции мини-карты (окно поверх игры и отслеживание)' })
    expect(card).toHaveTextContent('Сейчас выключены у всех игроков')
    expect(shown('Размер мини-карты')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Включить для всех' }))
    await screen.findByRole('button', { name: 'Выключить для всех' })
    expect(serviceRequest).toHaveBeenLastCalledWith('PUT', '/v1/accounts/me/admin/features', { minimap: true })
    expect(card).toHaveTextContent('Сейчас включены у всех игроков')
    expect(screen.getByRole('slider', { name: 'Размер мини-карты' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Выключить для всех' }))
    await screen.findByRole('button', { name: 'Включить для всех' })
    expect(serviceRequest).toHaveBeenLastCalledWith('PUT', '/v1/accounts/me/admin/features', { minimap: false })
    expect(shown('Размер мини-карты')).toBe(false)
  })

  it('a refused switch says so and changes nothing', async () => {
    desktop('owner')
    switchTo(false)
    serviceRequest.mockRejectedValue(new Error('404'))
    await page()
    dismissNotice()
    fireEvent.click(screen.getByRole('button', { name: 'Включить для всех' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось переключить')
    expect(shown('Размер мини-карты')).toBe(false)
  })

  it('in English', async () => {
    setRenderLanguage('en')
    desktop('owner')
    switchTo(true)
    render(<ExperimentalPage />)
    expect(await screen.findByText('Mini map features (the window over the game and tracking)')).toBeInTheDocument()
    expect(screen.getByText('Now on for all players')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off for everyone' })).toBeInTheDocument()
  })
})

describe('«Обзор»: the position card', () => {
  it('only while the owner allows the minimap', async () => {
    api.getStatus.mockResolvedValue(unbound)
    switchTo(false)
    const { container } = render(<PositionSetupNotice />)
    await act(async () => { await Promise.resolve() })
    expect(container).toBeEmptyDOMElement()
    expect(api.getStatus).not.toHaveBeenCalled()

    switchTo(true)
    await screen.findByText('В игре не назначена клавиша скриншота')
    switchTo(false)
    expect(container).toBeEmptyDOMElement()
  })
})
