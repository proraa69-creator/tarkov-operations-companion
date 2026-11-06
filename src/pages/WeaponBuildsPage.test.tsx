import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RaidMode } from '../domain/types'
import type { PurchaseAccess } from '../arsenal/buildStats'
import { adaptAmmo, adaptMods, adaptWeapons } from '../arsenal/gunQueries'
import { ammoPayload, FX, gunsPayload, modsPayload } from '../arsenal/fixtures/gunFixture'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { computeExtraCost } from '../arsenal/buildStats'
import { installPart, presetBuild } from '../arsenal/buildModel'
import { encodeBuild } from '../arsenal/buildStorage'
import { formatRub, weaponIcon } from '../arsenal/gunFormat'
import { WeaponBuildsPage } from './WeaponBuildsPage'

const catalog = { weapons: adaptWeapons(gunsPayload('ru')), mods: adaptMods(modsPayload('ru')), ammo: adaptAmmo(ammoPayload('ru')), loadedAt: '2026-11-04T00:00:00.000Z', source: 'live' as const }

const state = vi.hoisted(() => ({ mode: 'pvp' as RaidMode, access: {} as unknown, fleaEnabled: true }))
const listSharedBuilds = vi.hoisted(() => vi.fn(async () => ({ builds: [], total: 0 })))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: state.mode }) }))
vi.mock('../arsenal/gunCatalog', () => ({ useGunCatalog: () => ({ data: catalog, isLoading: false, isError: false }) }))
vi.mock('../data/livePrices', () => ({ useLivePrices: () => null }))
vi.mock('../gunsmith/useGunsmithAccess', () => ({ useGunsmithAccess: () => ({ access: state.access, infos: [], setLevel: () => {}, fleaEnabled: state.fleaEnabled }) }))
vi.mock('../arsenal/ownerBuilds', () => ({ useOwnerBuilds: () => ({ builds: [], learned: new Map() }), partsMissingFrom: () => [] }))
vi.mock('../arsenal/buildCatalogClient', () => ({ listSharedBuilds, publishBuild: vi.fn(), removeSharedBuild: vi.fn(), toggleBuildLike: vi.fn() }))

/** What the game's level gives (src/gunsmith/traderLevels.ts playerAccess). */
const access = (playerLevel: number, extra: Partial<PurchaseAccess> = {}): PurchaseAccess => ({ traderLevel: 1, flea: playerLevel >= 15, playerLevel, fleaOpensAt: 15, traderLevels: {}, ...extra })
const renderPage = () => render(<LocaleProvider><MemoryRouter initialEntries={[`/arsenal/builds?weapon=${FX.m4}`]}><WeaponBuildsPage /></MemoryRouter></LocaleProvider>)
const tab = (name: string) => screen.getByRole('tab', { name })
const flea = () => screen.getByRole('checkbox', { name: 'Барахолка доступна' })

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  localStorage.clear()
  state.mode = 'pvp'
  state.access = access(20)
  state.fleaEnabled = true
  listSharedBuilds.mockClear()
})
afterEach(() => setRenderLanguage('ru'))

describe('«Сборка оружия»: the three lists', () => {
  // Owner, 06.11.2026: «Там нужно писать цену… по этим модулям берет цену, без учета оружия», «Должно быть всегда цельное оружие».
  it('«Сборки игроков»: the whole gun in the picture, and what the mods added to it cost, the weapon left out', async () => {
    const m4 = catalog.weapons.find((weapon) => weapon.id === FX.m4)!
    const stock = presetBuild(m4, catalog).build
    const built = installPart(stock, ['mod_pistol_grip'], FX.gripErgo, catalog)
    const cost = computeExtraCost(built, stock, catalog, state.access as PurchaseAccess)
    expect(cost.lines.map((line) => line.part.id)).toEqual([FX.gripErgo])
    listSharedBuilds.mockResolvedValueOnce({ builds: [{ id: 'b1', mode: 'pvp', weaponId: FX.m4, name: 'Сборка друга', code: encodeBuild(built, catalog)!, author: 'друг', likes: 0, liked: false, mine: false, createdAt: '' }], total: 1 } as never)
    renderPage()
    fireEvent.click(tab('Сборки игроков'))
    const row = (await screen.findByText('Сборка друга')).closest('li')!
    expect(row.querySelector('img')!.getAttribute('src')).toBe(weaponIcon(m4))
    expect(weaponIcon({ iconLink: 'receiver', defaultPreset: { iconLink: 'whole' } })).toBe('whole')
    expect(weaponIcon({ iconLink: 'receiver' })).toBe('receiver')
    const price = row.querySelector('.wb-top-cost')!
    const flat = (value: string) => value.split(String.fromCharCode(32)).join('').split(String.fromCharCode(160)).join('')
    expect(flat(price.textContent!)).toBe(flat(formatRub(cost.total) + 'за модули'))
    expect(cost.total).toBeGreaterThan(0)
  })

  // Owner, 06.11.2026: «Оставь только сборки», the same frame on all three, the columns level.
  it('«Готовые сборки»: only the builds, in one frame; nothing sets a build for everybody', async () => {
    Object.assign(window, { __raidosOwnerEdition: true })
    renderPage()
    fireEvent.click(tab('Готовые сборки'))
    await waitFor(() => expect(document.querySelector('.wb-auto-list, .wb-auto .wb-none:not([role="status"])')).toBeTruthy())
    expect(document.querySelector('.wb-owner-tiers')).toBeNull()
    expect(screen.queryByText(/Сборка на верстаке/)).toBeNull()
    for (const chip of document.querySelectorAll('.wb-auto-tier')) expect(chip.className).toBe('wb-auto-tier')
  })

  // Owner, 04.11.2026: «либо "Мои сборки", либо "Готовые сборки"… И добавь еще третье окно "Сборки игроков"».
  it('has «Мои сборки», «Готовые сборки» and «Сборки игроков», and no «Топ сборок»', () => {
    renderPage()
    expect(screen.getAllByRole('tab').map((entry) => entry.textContent)).toEqual(['Мои сборки', 'Готовые сборки', 'Сборки игроков'])
    expect(screen.queryByText('Топ сборок')).toBeNull()
  })

  it('«Готовые сборки» are the program\'s builds, with no buttons of weapon or order', async () => {
    renderPage()
    fireEvent.click(tab('Готовые сборки'))
    await waitFor(() => expect(document.querySelector('.wb-auto-list, .wb-auto .wb-none:not([role="status"])')).toBeTruthy())
    for (const name of ['Всё оружие', 'Лучшие', 'Новые']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(listSharedBuilds).not.toHaveBeenCalled()
  })

  it('«Сборки игроков» are the players\' builds of the open weapon, the most liked first', async () => {
    renderPage()
    fireEvent.click(tab('Сборки игроков'))
    await waitFor(() => expect(screen.getByText(/Соберите и нажмите «Опубликовать»/)).toBeInTheDocument())
    expect(listSharedBuilds).toHaveBeenCalledWith('pvp', { weaponId: FX.m4, sort: 'top' })
  })
})

// Owner, 04.11.2026: «Рядом с кнопкой "Торговцы" сделай рядом галочку "Барахолка доступна"… если ты выше 15 уровня, автоматически ставит галочку».
describe('«Сборка оружия»: «Барахолка доступна»', () => {
  it('stands beside «Торговцы» and follows the character\'s level', () => {
    const { unmount } = renderPage()
    expect(flea()).toBeChecked()
    expect(screen.getByRole('button', { name: 'Торговцы' }).closest('.wb-traders')!.nextElementSibling).toContainElement(flea() as HTMLElement)
    unmount()
    state.access = access(14)
    renderPage()
    expect(flea()).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'по уровню персонажа' })).toBeNull()
  })

  it('a choice of one\'s own stays in its mode and goes when it agrees with the level', () => {
    const { unmount } = renderPage()
    fireEvent.click(flea())
    expect(flea()).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'по уровню персонажа' })).toBeInTheDocument()
    unmount()
    state.mode = 'pve'
    const pve = renderPage()
    expect(flea()).toBeChecked()
    pve.unmount()
    state.mode = 'pvp'
    renderPage()
    expect(flea()).not.toBeChecked()
    fireEvent.click(flea())
    expect(flea()).toBeChecked()
    expect(screen.queryByRole('button', { name: 'по уровню персонажа' })).toBeNull()
    expect(localStorage.getItem('raid-os-gun-flea-v3:pvp')).toBeNull()
  })

  it('a mode without a flea market has nothing to tick', () => {
    state.fleaEnabled = false
    state.access = access(40, { flea: false, fleaOpensAt: undefined })
    renderPage()
    expect(flea()).toBeDisabled()
    expect(flea()).not.toBeChecked()
  })
})

// Owner, 04.11.2026: «модули должны быть открыты при достижении этих условий».
describe('«Сборка оружия»: what opens a module', () => {
  const openMagazines = () => {
    const stanag = screen.getAllByRole('button').find((entry) => entry.classList.contains('wb-cell') && entry.textContent?.includes('STANAG'))
    fireEvent.click(stanag!)
    return screen.getByRole('region', { name: 'Магазин' })
  }

  it('lists what can be bought now and counts the rest; unticked, the rest says what opens it', () => {
    state.access = access(5)
    renderPage()
    const picker = openMagazines()
    const options = () => within(picker).getAllByRole('option')
    expect(within(picker).getByRole('checkbox', { name: 'Можно купить' })).toBeChecked()
    expect(options().map((entry) => entry.textContent)).not.toContainEqual(expect.stringContaining('D-60'))
    expect(picker.querySelector('.wb-picker-closed')).toHaveTextContent('ещё закрыто: 1')
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Можно купить' }))
    const locked = options().find((entry) => entry.textContent?.includes('D-60'))!
    expect(locked).toHaveClass('is-locked')
    expect(locked.querySelector('.wb-part-lock')).toHaveTextContent(/Миротворец 3|барахолка с 15 ур\./)
    expect(picker.querySelector('.wb-picker-closed')).toBeNull()
    expect(localStorage.getItem('raid-os-gun-buyable-v1')).toBe('all')
  })

  it('at the conditions reached the module is open', () => {
    state.access = access(40, { traderLevels: { peacekeeper: 3 } })
    renderPage()
    const picker = openMagazines()
    const open = within(picker).getAllByRole('option').find((entry) => entry.textContent?.includes('D-60'))!
    expect(open).not.toHaveClass('is-locked')
    expect(open.querySelector('.wb-part-lock')).toBeNull()
  })
})
