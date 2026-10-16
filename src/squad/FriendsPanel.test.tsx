import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { FriendsPanel } from './FriendsPanel'
import { PrestigeBadge } from './FriendInfoDialog'
import type { FriendsOverview } from './socialClient'

const WOLF = 'a'.repeat(24)
const OWL = 'b'.repeat(24)

function overview(access = true): FriendsOverview {
  return {
    code: '7KQ2-M9XD', access, incoming: [], outgoing: [], blocked: [],
    friends: [
      { friendId: WOLF, nicknames: { pvp: 'Wolfhound' }, since: '2026-10-01T10:00:00.000Z', hideMyProgress: false, sharesProgress: true },
      { friendId: OWL, nicknames: { pvp: 'Nightowl_7' }, since: '2026-10-02T10:00:00.000Z', hideMyProgress: false, sharesProgress: false },
    ],
  } as FriendsOverview
}

function mockDesktop(answers: Record<string, unknown>) {
  const serviceRequest = vi.fn((_method: string, path: string) => (path in answers ? Promise.resolve(answers[path]) : Promise.reject(new Error('offline'))))
  Object.assign(window, { tarkovDesktop: { isDesktop: true, serviceRequest } })
  return serviceRequest
}

const panel = (friends = overview()) => <FriendsPanel mode="pvp" data={{ quests: [] }} friends={friends} error="" loading={false} reload={() => Promise.resolve()} />

describe('FriendsPanel: the friend\'s colour and info', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop') })

  it('shows each friend\'s colour and, on the square button, levels and prestige in every mode', async () => {
    const serviceRequest = mockDesktop({
      [`/v1/friends/${WOLF}/info`]: { nickname: 'Wolfhound', hidden: false, modes: { pvp: { level: 52, prestige: 2, updatedAt: '2026-10-13T12:00:00.000Z', source: 'app' }, pve: { level: 17, prestige: 0, updatedAt: null, source: 'tarkov-dev' }, seasonal: null } },
    })
    const user = userEvent.setup()
    render(panel())
    // Colours as in «План рейда» and on the map: kept per friend on this computer.
    const dots = document.querySelectorAll<HTMLElement>('.squad-friend-dot')
    expect(dots).toHaveLength(2)
    const colors = JSON.parse(localStorage.getItem('raidos-friend-colors-v1') ?? '{}') as Record<string, number>
    expect(Object.keys(colors).sort()).toEqual([WOLF, OWL])
    expect(colors[WOLF]).not.toBe(colors[OWL])

    const [wolfInfo] = screen.getAllByRole('button', { name: 'Информация о друге' })
    await user.click(wolfInfo!)
    const dialog = await screen.findByRole('dialog', { name: 'Информация о друге Wolfhound' })
    expect(serviceRequest).toHaveBeenCalledWith('GET', `/v1/friends/${WOLF}/info`, undefined)
    const pvp = (await within(dialog).findByText('PVP')).closest('.friend-info-mode')!
    expect(pvp).toHaveTextContent('52')
    expect(within(pvp as HTMLElement).getByRole('img', { name: 'Престиж 2' })).toHaveAttribute('data-level', '2')
    // When the level was true, dim under it; the tooltip says it came from the friend's own app.
    expect(within(pvp as HTMLElement).getByText(/обновлено/)).toHaveTextContent('обновлено 13.10.2026')
    expect(within(pvp as HTMLElement).getByText(/обновлено/)).toHaveAttribute('title', 'Из приложения друга')
    const pve = within(dialog).getByText('PVE').closest('.friend-info-mode')!
    expect(pve).toHaveTextContent('17')
    // A known prestige 0 says so; no date without one.
    expect(pve).toHaveTextContent('Без престижа')
    expect(pve).not.toHaveTextContent('обновлено')
    expect(within(dialog).getByText('Сезон').closest('.friend-info-mode')).toHaveTextContent('нет данных')
    // No note under the modes (owner, 12.10.2026: «убери нижнюю надпись»).
    expect(dialog).not.toHaveTextContent('tarkov.dev')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says so when the friend hides their progress, and needs a subscription', async () => {
    mockDesktop({ [`/v1/friends/${OWL}/info`]: { nickname: 'Nightowl_7', hidden: true, modes: {} } })
    const user = userEvent.setup()
    const { unmount } = render(panel())
    await user.click(screen.getAllByRole('button', { name: 'Информация о друге' })[1]!)
    expect(await screen.findByText('Друг скрыл от вас прогресс — уровни не показываются.')).toBeInTheDocument()
    expect(screen.queryByText('PVP')).toBeNull()
    unmount()

    render(panel(overview(false)))
    for (const button of screen.getAllByRole('button', { name: 'Информация о друге' })) expect(button).toBeDisabled()
  })

  it('shows no badge for a prestige the friend\'s app does not know, and no note when nothing is known', async () => {
    mockDesktop({
      [`/v1/friends/${WOLF}/info`]: { nickname: 'Wolfhound', hidden: false, modes: { pvp: { level: 41, prestige: null, updatedAt: '2026-10-13T12:00:00.000Z', source: 'app' }, pve: null, seasonal: null } },
      [`/v1/friends/${OWL}/info`]: { nickname: 'Nightowl_7', hidden: false, modes: { pvp: null, pve: null, seasonal: null } },
    })
    const user = userEvent.setup()
    render(panel())
    const [wolfInfo, owlInfo] = screen.getAllByRole('button', { name: 'Информация о друге' })
    await user.click(wolfInfo!)
    const dialog = await screen.findByRole('dialog', { name: 'Информация о друге Wolfhound' })
    const pvp = (await within(dialog).findByText('PVP')).closest('.friend-info-mode') as HTMLElement
    expect(pvp).toHaveTextContent('41')
    expect(pvp).toHaveTextContent('обновлено 13.10.2026')
    expect(pvp.querySelector('.prestige-badge')).toBeNull()
    expect(pvp).not.toHaveTextContent('Без престижа')
    await user.keyboard('{Escape}')

    // Nothing known in any mode: «нет данных» three times and nothing under them.
    await user.click(owlInfo!)
    const empty = await screen.findByRole('dialog', { name: 'Информация о друге Nightowl_7' })
    await within(empty).findByText('PVP')
    expect(within(empty).getAllByText('нет данных')).toHaveLength(3)
    expect(empty.querySelectorAll('.friend-info-modes ~ *')).toHaveLength(0)
    expect(empty).not.toHaveTextContent('синхронизировал')
  })

  it('reads the same in English', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    mockDesktop({
      [`/v1/friends/${WOLF}/info`]: { nickname: 'Wolfhound', hidden: false, modes: { pvp: { level: 52, prestige: 2, updatedAt: '2026-10-13T12:00:00.000Z', source: 'app' }, pve: { level: 9, prestige: 0, updatedAt: '2026-08-01T12:00:00.000Z', source: 'tarkov-dev' }, seasonal: { level: 14, prestige: null, updatedAt: '2026-10-12T12:00:00.000Z', source: 'app' } } },
    })
    const user = userEvent.setup()
    try {
      render(<LocaleProvider>{panel()}</LocaleProvider>)
      await user.click(screen.getAllByRole('button', { name: 'Friend info' })[0]!)
      const dialog = await screen.findByRole('dialog', { name: 'Friend info Wolfhound' })
      const pvp = (await within(dialog).findByText('PVP')).closest('.friend-info-mode') as HTMLElement
      expect(within(pvp).getByRole('img', { name: 'Prestige 2' })).toBeInTheDocument()
      expect(within(pvp).getByText(/updated/)).toHaveTextContent('updated 13/10/2026')
      expect(within(pvp).getByText(/updated/)).toHaveAttribute('title', "From your friend's app")
      const pve = within(dialog).getByText('PVE').closest('.friend-info-mode') as HTMLElement
      expect(pve).toHaveTextContent('No prestige')
      expect(within(pve).getByText(/updated/)).toHaveAttribute('title', 'From the public Tarkov.dev profile')
      const season = within(dialog).getByText('Season').closest('.friend-info-mode') as HTMLElement
      expect(season).toHaveTextContent('updated 12/10/2026')
      expect(season.querySelector('.prestige-badge')).toBeNull()
      expect(dialog).not.toHaveTextContent(/[А-Яа-яЁё]/)
    } finally {
      const { setRenderLanguage } = await import('../i18n/renderText')
      setRenderLanguage('ru')
    }
  })

  it('shows the game\'s badge of each prestige, the PvE set in PvE (owner, 16.10.2026)', () => {
    const { container } = render(<>{[1, 3, 4, 5, 6].map((level) => <PrestigeBadge key={level} level={level} mode="pvp" />)}<PrestigeBadge level={6} mode="pve" /></>)
    const pictures = [...container.querySelectorAll('.prestige-badge img')] as HTMLImageElement[]
    expect(pictures.map((picture) => picture.dataset.level)).toEqual(['1', '3', '4', '5', '6', '6'])
    expect(pictures.map((picture) => picture.dataset.mode)).toEqual(['pvp', 'pvp', 'pvp', 'pvp', 'pvp', 'pve'])
    expect(new Set(pictures.map((picture) => picture.getAttribute('src'))).size).toBe(6)
    expect(screen.getAllByRole('img', { name: 'Престиж 6' })).toHaveLength(2)
  })

  it('has English for the new phrases', async () => {
    const { setRenderLanguage, uiText } = await import('../i18n/renderText')
    setRenderLanguage('en')
    try {
      expect(uiText('Информация о друге')).toBe('Friend info')
      expect(uiText('Без престижа')).toBe('No prestige')
      expect(uiText('Квесты друзей')).toBe("Friends' quests")
      expect(uiText('Друг скрыл от вас прогресс — уровни не показываются.')).toBe('Your friend hides their progress from you, so the levels are not shown.')
    } finally {
      setRenderLanguage('ru')
    }
  })
})
