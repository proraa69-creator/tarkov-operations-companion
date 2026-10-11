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
  it('shows the taken part, the whole chain and opens the weapon with its parts and translated stats', async () => {
    render(<LocaleProvider><MemoryRouter><GunsmithPanel steps={gunsmithSteps(quests, (id) => statuses[id])} playerLevel={12} /></MemoryRouter></LocaleProvider>)
    expect(screen.getByText('Оружейник')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Посмотреть все/ })).toHaveAttribute('href', '/gunsmith')
    expect(screen.getByText('Механик · выполнено 1 из 3')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: /Оружейник. Часть 2/ }))
    expect(screen.getByText('HK 416A5 5.56x45')).toBeInTheDocument()
    expect(screen.getByText('Эффективная дальность')).toBeInTheDocument()
    expect(screen.getByText('≤ 4 кг')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /SOCOM556-RC2/ })).toHaveAttribute('href', '/flea?selected=rc2')
    expect(screen.getByRole('link', { name: /Как собрать/ })).toHaveAttribute('href', '/gunsmith?part=2')
    // A locked part from the chain strip says when it opens.
    await userEvent.click(screen.getByTitle(/Часть 3/))
    expect(screen.getByText(/с 13 уровня/)).toBeInTheDocument()
  })
})
