import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
// The third part has tarkov.help's finished build, kept on our server.
const GUIDE_IMAGE = 'https://raidos.app/v1/guide-images/01237903-b29f-417c-83f3-671060fb220b.jpg'
const quests: Quest[] = [1, 2, 3].map((n) => ({
  id: `gs${n}`, name: `Оружейник. Часть ${n}`, normalizedName: `gunsmith-part-${n}`, trader: 'Механик', level: 2 + n, kappa: true, description: '', objectives: [], rewards: ['5 000 опыта'],
  objectiveDetails: [{ id: `o${n}`, type: 'buildWeapon', description: 'Модифицировать M4A1 в соответствии с требуемой спецификацией', count: 1,
    build: { weaponId: FX.m4, partIds: [FX.suppressor, FX.holo], attributes: [{ name: 'recoil', compare: '<=', value: 220 }, { name: 'effectiveDistance', compare: '>=', value: 300 }],
      ...(n === 3 ? { guide: { source: 'tarkov.help' as const, image: GUIDE_IMAGE, parts: [] } } : {}) } }],
}))
// «Оружейник. М4A1» as tarkov.dev has it: the owner's own screenshot of its build ships with the app.
const M4A1_PART = '5ac244eb86f7741356335af1'
quests.push({
  id: M4A1_PART, name: 'Оружейник. М4A1', normalizedName: 'gunsmith-m4a1', trader: 'Механик', level: 26, kappa: true, description: '', objectives: [], rewards: [],
  objectiveDetails: [{ id: 'o-m4a1', type: 'buildWeapon', description: 'Модифицировать M4A1 в соответствии с требуемой спецификацией', count: 1,
    build: { weaponId: '5447a9cd4bdc2dbd208b4567', partIds: [], attributes: [{ name: 'magazineCapacity', compare: '>=', value: 60 }], guide: { source: 'tarkov.help', image: GUIDE_IMAGE, parts: [] } } }],
})
const items: Item[] = [
  { id: FX.m4, name: 'Colt M4A1', shortName: 'M4A1', category: 'Оружие', description: '', prices: [] },
  { id: FX.suppressor, name: 'Глушитель SureFire SOCOM556-RC2 5.56x45', shortName: 'RC2', category: 'Оружие', description: '', prices: [] },
  { id: FX.holo, name: 'Голографический прицел EOTech EXPS3', shortName: 'EXPS3', category: 'Оружие', description: '', prices: [] },
]
const profile = createLocalProfile('Operator', 'p-gunsmith')
// Two of Prapor's quests: one handed in with the other never in the logs — a history older than the logs.
quests.push(
  { id: 'q-early', name: 'Дебют', normalizedName: 'debut', trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] },
  { id: 'q-late', name: 'Проверка на вшивость', normalizedName: 'checking', trader: 'Прапор', level: 2, kappa: false, description: '', objectives: [], rewards: [], previous: ['q-early'] },
)
const traders = [{ id: 't-pk', name: 'Миротворец', normalizedName: 'peacekeeper', role: '', loyalty: 4, accent: '', levelPlayerLevels: [1, 15, 26, 36] }]
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { quests, items, traders, metadata: {} } }) }))
const appState = vi.hoisted(() => ({ profile: undefined as ReturnType<typeof createLocalProfile> | undefined, setManualQuestMark: vi.fn() }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp', activeProfile: appState.profile ?? profile, setManualQuestMark: appState.setManualQuestMark }) }))
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

  it('shows the weapon instead of a finished-build screenshot that does not load', async () => {
    render(<LocaleProvider><MemoryRouter initialEntries={['/gunsmith?quest=gs3']}><GunsmithPage /></MemoryRouter></LocaleProvider>)
    const screenshot = screen.getByRole('button', { name: 'Открыть сборку на весь экран' }).querySelector('img')!
    expect(screenshot.getAttribute('src')).toBe(GUIDE_IMAGE)
    expect(screen.getByText('Готовая сборка: tarkov.help')).toBeInTheDocument()
    fireEvent.error(screenshot)
    expect(screen.queryByRole('button', { name: 'Открыть сборку на весь экран' })).toBeNull()
    expect(screen.queryByText('Готовая сборка: tarkov.help')).toBeNull()
    // The whole rifle: its default preset's picture from the mod data.
    await waitFor(() => expect(document.querySelector('.gs-weapon img')?.getAttribute('src')).toMatch(/m4/))
  })

  it('shows the owner\'s own screenshot of the build instead of tarkov.help\'s, which stays as the fallback', () => {
    render(<LocaleProvider><MemoryRouter initialEntries={[`/gunsmith?quest=${M4A1_PART}`]}><GunsmithPage /></MemoryRouter></LocaleProvider>)
    expect(screen.getByRole('heading', { level: 2, name: 'Оружейник. М4A1' })).toBeInTheDocument()
    const own = screen.getByRole('button', { name: 'Открыть сборку на весь экран' }).querySelector('img')!
    expect(own.getAttribute('src')).toMatch(/gunsmith-m4a1[^/]*\.webp$/)
    expect(screen.queryByText('Готовая сборка: tarkov.help')).toBeNull()
    fireEvent.error(own)
    const guide = screen.getByRole('button', { name: 'Открыть сборку на весь экран' }).querySelector('img')!
    expect(guide.getAttribute('src')).toBe(GUIDE_IMAGE)
    expect(screen.getByText('Готовая сборка: tarkov.help')).toBeInTheDocument()
    fireEvent.error(guide)
    expect(screen.queryByRole('button', { name: 'Открыть сборку на весь экран' })).toBeNull()
  })

  it('ticks the parts by hand: the player\'s own «Выполнено» of the mode (a player\'s ticket, 02.11.2026)', () => {
    const ticked = createLocalProfile('Operator', 'p-ticked')
    const at = '2026-11-02T09:00:00.000Z'
    ticked.modes.pvp = {
      ...ticked.modes.pvp,
      taskProgress: {
        gs1: { taskId: 'gs1', status: 'completed', source: 'eft-log', updatedAt: '2026-10-31T12:03:00.000Z' },
        gs2: { taskId: 'gs2', status: 'completed', source: 'manual-fix', updatedAt: at },
        'q-late': { taskId: 'q-late', status: 'completed', source: 'eft-log', updatedAt: '2026-10-30T10:00:00.000Z' },
      },
      questInputs: { log: {}, server: {}, manual: { gs2: { status: 'completed', at } }, table: {}, story: {}, legacy: {} },
    }
    appState.profile = ticked
    try {
      render(<LocaleProvider><MemoryRouter initialEntries={['/gunsmith?quest=gs2']}><GunsmithPage /></MemoryRouter></LocaleProvider>)
      // The history is older than the logs: the parts they never saw are dimmed, and the list says why and what to do.
      expect(screen.getByText(/Отметьте галочкой части, которые вы сделали раньше/)).toBeInTheDocument()
      const byGame = screen.getByRole('checkbox', { name: 'Выполнено: Оружейник. Часть 1' })
      expect(byGame).toHaveAttribute('aria-checked', 'true')
      expect(byGame).toBeDisabled()
      expect(byGame).toHaveAttribute('title', 'Выполнено в игре')
      const byHand = screen.getByRole('checkbox', { name: 'Выполнено: Оружейник. Часть 2' })
      expect(byHand).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByText('вручную')).toBeInTheDocument()
      fireEvent.click(byHand)
      expect(appState.setManualQuestMark).toHaveBeenLastCalledWith('pvp', 'gs2', null)
      const notSeen = screen.getByRole('checkbox', { name: 'Выполнено: Оружейник. Часть 3' })
      expect(notSeen).toHaveAttribute('aria-checked', 'false')
      fireEvent.click(notSeen)
      expect(appState.setManualQuestMark).toHaveBeenLastCalledWith('pvp', 'gs3', 'completed')
      // The selected part's card: «В текущие», «Выполнено», «Снять отметку», as on «Квесты».
      fireEvent.click(screen.getByRole('button', { name: 'В текущие' }))
      expect(appState.setManualQuestMark).toHaveBeenLastCalledWith('pvp', 'gs2', 'active')
    } finally {
      appState.profile = undefined
      appState.setManualQuestMark.mockReset()
    }
  })

  it('asks for no ticks when the logs hold the whole history', () => {
    render(<LocaleProvider><MemoryRouter initialEntries={['/gunsmith']}><GunsmithPage /></MemoryRouter></LocaleProvider>)
    expect(screen.queryByText(/Отметьте галочкой/)).toBeNull()
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
  })
})
