import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Item, Quest } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { GunsmithPanel } from './GunsmithPanel'
import { gunsmithSteps } from './gunsmith'

const items: Item[] = [
  { id: 'hk416', name: 'HK 416A5 5.56x45', shortName: 'HK 416A5', category: 'Оружие', description: '', prices: [], presetImageUrl: 'https://assets.tarkov.dev/hk416-512.webp' },
  { id: 'rc2', name: 'Глушитель SureFire SOCOM556-RC2', shortName: 'SOCOM556-RC2', category: 'Инструмент', description: '', prices: [], iconUrl: 'https://assets.tarkov.dev/rc2.webp' },
]
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { items } }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp' }) }))
// The mod data is still loading: the block shows the weapon and its requirements meanwhile.
vi.mock('../arsenal/gunCatalog', () => ({ useGunCatalog: () => ({ isLoading: true, data: undefined }) }))
vi.mock('./useGunsmithAccess', () => ({ useGunsmithAccess: () => ({ access: { traderLevel: 4, flea: true }, infos: [], setLevel: () => {}, traders: new Map(), questName: () => undefined, mode: 'pvp', playerLevel: 12 }) }))

const part = (n: number, extra: Partial<Quest> = {}): Quest => ({
  id: `gs${n}`, name: `Оружейник. Часть ${n}`, normalizedName: `gunsmith-part-${n}`, trader: 'Механик', level: 10 + n, kappa: true, description: '', objectives: [], rewards: [], ...extra,
})
const quests = [
  part(1),
  part(2, { objectiveDetails: [{ id: 'o', type: 'buildWeapon', description: 'Модифицировать HK 416A5', count: 1, build: { weaponId: 'hk416', partIds: ['rc2'], attributes: [{ name: 'effectiveDistance', compare: '>=', value: 300 }, { name: 'weight', compare: '<=', value: 4 }] } }] }),
  part(3),
]
const statuses: Record<string, 'completed' | 'active' | 'locked'> = { gs1: 'completed', gs2: 'active', gs3: 'locked' }

describe('«Оружейник» on the Overview', () => {
  const view = (map: Record<string, 'completed' | 'active' | 'locked'>, playerLevel: number) =>
    render(<LocaleProvider><MemoryRouter><GunsmithPanel steps={gunsmithSteps(quests, (id) => map[id])} playerLevel={playerLevel} /></MemoryRouter></LocaleProvider>)

  it('shows just the current part by name and opens its weapon, stats and parts', async () => {
    view(statuses, 12)
    expect(screen.getByText('Оружейник')).toBeInTheDocument()
    // «Посмотреть все» is set like «N на Таможне» of «Текущие задания».
    expect(screen.getByRole('link', { name: /Посмотреть все/ })).toHaveAttribute('href', '/gunsmith')
    expect(screen.getByRole('link', { name: /Посмотреть все/ })).toHaveClass('current-tasks-where')
    // No chain strip, no part numbers, no progress line: only the part taken in the game.
    expect(screen.queryByText(/выполнено/)).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByText('Оружейник. Часть 1')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Оружейник. Часть 2/ }))
    expect(screen.getByText('HK 416A5 5.56x45')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'HK 416A5 5.56x45' })).toHaveAttribute('src', 'https://assets.tarkov.dev/hk416-512.webp')
    expect(screen.getByText('Эффективная дальность')).toBeInTheDocument()
    expect(screen.getByText('≤ 4 кг')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /SOCOM556-RC2/ })).toHaveAttribute('href', '/flea?selected=rc2')
    expect(screen.getByRole('link', { name: /Как собрать/ })).toHaveAttribute('href', '/gunsmith?part=2')
  })

  it('with no part taken, shows the next one and when it opens', () => {
    view({ gs1: 'completed', gs2: 'locked', gs3: 'locked' }, 5)
    expect(screen.getByRole('button', { name: /Оружейник. Часть 2/ })).toBeInTheDocument()
    expect(screen.getByText(/с 12 уровня/)).toBeInTheDocument()
  })
})
