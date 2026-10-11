import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { adaptMods, adaptWeapons } from '../arsenal/gunQueries'
import { FX, gunsPayload, modsPayload } from '../arsenal/fixtures/gunFixture'
import { createLocalProfile } from '../domain/progress'
import type { Item, Quest } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { GunsmithPage } from './GunsmithPage'

const catalog = { weapons: adaptWeapons(gunsPayload('ru')), mods: adaptMods(modsPayload('ru')), ammo: [], loadedAt: '', source: 'live' as const }
const quests: Quest[] = [1, 2].map((n) => ({
  id: `gs${n}`, name: `Оружейник. Часть ${n}`, normalizedName: `gunsmith-part-${n}`, trader: 'Механик', level: 2 + n, kappa: true, description: '', objectives: [], rewards: ['5 000 опыта'],
  objectiveDetails: [{ id: `o${n}`, type: 'buildWeapon', description: 'Модифицировать M4A1 в соответствии с требуемой спецификацией', count: 1,
    build: { weaponId: FX.m4, partIds: [FX.suppressor, FX.holo], attributes: [{ name: 'recoil', compare: '<=', value: 220 }, { name: 'effectiveDistance', compare: '>=', value: 300 }] } }],
}))
const items: Item[] = [
  { id: FX.m4, name: 'Colt M4A1', shortName: 'M4A1', category: 'Оружие', description: '', prices: [] },
  { id: FX.suppressor, name: 'Глушитель SureFire SOCOM556-RC2 5.56x45', shortName: 'RC2', category: 'Оружие', description: '', prices: [] },
  { id: FX.holo, name: 'Голографический прицел EOTech EXPS3', shortName: 'EXPS3', category: 'Оружие', description: '', prices: [] },
]
const profile = createLocalProfile('Operator', 'p-gunsmith')
const traders = [{ id: 't-pk', name: 'Миротворец', normalizedName: 'peacekeeper', role: '', loyalty: 4, accent: '', levelPlayerLevels: [1, 15, 26, 36] }]
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { quests, items, traders, metadata: {} } }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp', activeProfile: profile }) }))
vi.mock('../arsenal/gunCatalog', () => ({ useGunCatalog: () => ({ data: catalog, isLoading: false }) }))

describe('«Оружейник → Посмотреть все»', () => {
  it('lists every part and shows the selected one: its stats and the modules, who sells each on hover; no example section', async () => {
    render(<LocaleProvider><MemoryRouter initialEntries={['/gunsmith?part=2']}><GunsmithPage /></MemoryRouter></LocaleProvider>)
    expect(screen.getAllByText('Оружейник. Часть 1').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 2, name: 'Оружейник. Часть 2' })).toBeInTheDocument()
    expect(screen.getByText('Эффективная дальность')).toBeInTheDocument()
    // The mod data's example build only fills in the stats' values and the alternatives (owner: no «Как собрать» section).
    await waitFor(() => expect(screen.getAllByText('в игре').length).toBeGreaterThan(0))
    expect(screen.queryByText('Как собрать · пример сборки')).toBeNull()
    expect(screen.queryByText('Что купить')).toBeNull()
    const suppressor = screen.getByRole('link', { name: /SOCOM556-RC2/ })
    // Who sells it from which level (a new character: loyalty 1, so Peacekeeper's III is locked), in the hover window.
    await userEvent.hover(suppressor)
    const window = await screen.findByRole('tooltip')
    expect(window.textContent).toContain('Задание требует именно этот модуль')
    expect(window.querySelector('.gs-trader.is-locked .gs-trader-level')?.textContent).toBe('III')
  })
})
