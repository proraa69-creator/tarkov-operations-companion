import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
      [`/v1/friends/${WOLF}/info`]: { nickname: 'Wolfhound', hidden: false, modes: { pvp: { level: 52, prestige: 2, updatedAt: '2026-10-12T09:00:00.000Z' }, pve: { level: 17, prestige: 0, updatedAt: null }, seasonal: null } },
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
    expect(within(pvp as HTMLElement).getByRole('img', { name: 'Престиж 2' })).toHaveClass('tier-2')
    const pve = within(dialog).getByText('PVE').closest('.friend-info-mode')!
    expect(pve).toHaveTextContent('17')
    expect(pve).toHaveTextContent('Без престижа')
    expect(within(dialog).getByText('Сезон').closest('.friend-info-mode')).toHaveTextContent('нет данных')
    expect(dialog).toHaveTextContent('tarkov.dev')

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

  it('gives every prestige level its own badge', () => {
    const { container } = render(<>{[1, 2, 3, 4, 5, 6].map((level) => <PrestigeBadge key={level} level={level} />)}</>)
    const badges = [...container.querySelectorAll('.prestige-badge')]
    expect(badges.map((badge) => badge.textContent)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(badges.map((badge) => [...badge.classList].find((name) => name.startsWith('tier-')))).toEqual(['tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5', 'tier-5'])
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
