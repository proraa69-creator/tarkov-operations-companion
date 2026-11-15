import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adaptMods, adaptWeapons } from '../arsenal/gunQueries'
import { FX, gunsPayload, modsPayload } from '../arsenal/fixtures/gunFixture'
import { createLocalProfile } from '../domain/progress'
import type { Item, Quest } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setPhoneGunsmithView } from '../gunsmith/phoneGunsmithView'
import { GunsmithPage } from './GunsmithPage'

const catalog = { weapons: adaptWeapons(gunsPayload('ru')), mods: adaptMods(modsPayload('ru')), ammo: [], loadedAt: '', source: 'live' as const }
// The third part's guide has another site's picture, kept on our server: never shown.
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
vi.mock('../platform', async (original) => ({ ...(await original<typeof import('../platform')>()), useMobileLayout: () => true }))
vi.mock('../arsenal/gunCatalog', () => ({ useGunCatalog: () => ({ data: catalog, isLoading: false }) }))

// The phone (owner, 16.11.2026): a pressed part opens as a window with «Назад» (by default), or, as chosen in «Настройки»,
// unfolds under its row with a cross on the right; nothing opens below the list by itself.
function drawn(entry = '/gunsmith') {
  return render(<LocaleProvider><MemoryRouter initialEntries={['/', entry]} initialIndex={1}><GunsmithPage /></MemoryRouter></LocaleProvider>)
}
const row = (name: string) => screen.getAllByText(name).map((node) => node.closest('button.gunsmith-part-row')).find(Boolean) as HTMLElement

describe('«Оружейник» on the phone', () => {
  afterEach(() => { setPhoneGunsmithView('window'); cleanup() })

  it('the list alone; a part opens as a window, «Назад» returns to the list', async () => {
    drawn()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    await userEvent.click(row('Оружейник. Часть 2'))
    expect(screen.getByRole('heading', { level: 2, name: 'Оружейник. Часть 2' })).toBeInTheDocument()
    expect(document.querySelector('.gunsmith-parts')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Назад/ }))
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(document.querySelector('.gunsmith-parts')).not.toBeNull()
  })

  it('a link to a part opens its window; «Назад» stays on the page with the list', async () => {
    drawn('/gunsmith?quest=gs3')
    expect(screen.getByRole('heading', { level: 2, name: 'Оружейник. Часть 3' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Назад/ }))
    expect(document.querySelector('.gunsmith-parts')).not.toBeNull()
  })

  it('«Раскладывать»: the part under its row, the cross in the row closes it; another row moves it there', async () => {
    setPhoneGunsmithView('expand')
    drawn()
    await userEvent.click(row('Оружейник. Часть 1'))
    const first = row('Оружейник. Часть 1')
    expect(first.getAttribute('aria-expanded')).toBe('true')
    expect(first.querySelector('.gunsmith-part-close')).not.toBeNull()
    expect(first.closest('li')!.querySelector('.gunsmith-unfolded h2')?.textContent).toBe('Оружейник. Часть 1')
    await userEvent.click(row('Оружейник. Часть 2'))
    expect(document.querySelectorAll('.gunsmith-unfolded')).toHaveLength(1)
    expect(row('Оружейник. Часть 2').closest('li')!.querySelector('.gunsmith-unfolded')).not.toBeNull()
    await userEvent.click(row('Оружейник. Часть 2'))
    expect(document.querySelector('.gunsmith-unfolded')).toBeNull()
  })
})
