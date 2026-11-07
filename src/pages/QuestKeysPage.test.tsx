import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import type { Item, Quest, RaidMode } from '../domain/types'
import { deferredQuestsKey } from '../progression/deferredQuests'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage, uiText } from '../i18n/renderText'
import { questKeyFavoritesKey, readQuestKeyFavorites, readQuestKeyReminder } from '../quests/questKeyFavorites'
import { AppStateProvider } from '../state/AppState'
import { readOwnedKeys, setOwnedKey } from '../quests/ownedKeys'

const key = (itemId: string) => ({ itemId, purpose: 'key', count: 1, mapIds: ['customs'] })
const quest = (id: string, name: string, keys: string[]) => ({ id, name, normalizedName: id, trader: 'Прапор', level: 5, objectives: [], raidRequirements: keys.map(key) }) as unknown as Quest
const data = {
  items: [{ id: 'k1', name: 'Ключ от склада', shortName: 'Склад', category: 'Ключ' }, { id: 'k2', name: 'Ключ от гаража', shortName: 'Гараж', category: 'Ключ' }] as unknown as Item[],
  quests: [quest('q1', 'Первый', ['k1']), quest('q2', 'Второй', ['k1']), quest('q3', 'Третий', ['k2'])],
  maps: [{ id: 'customs', name: 'Таможня' }],
  traders: [],
}
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data }), useOptionalTarkovData: () => ({ data }) }))
vi.mock('../gunsmith/useGunsmithAccess', () => ({ useTraderLoyalty: () => new Map() }))
// the key's price and barters (quests/QuestKeyMarket.tsx) come from the network: none here
vi.mock('../data/useEconomy', () => ({ useEconomySnapshot: () => ({ data: undefined }) }))
vi.mock('../data/livePrices', () => ({ useLivePrices: () => null, withLivePrice: (item: unknown) => item }))
vi.mock('../progression/itemUnlocks', () => ({ useItemUnlocks: () => ({ isPending: false, isError: false, data: undefined }), unlockSources: () => [] }))

const { QuestKeysPage } = await import('./QuestKeysPage')

function open(done: string[] = [], favorites: string[] = [], at = '/quest-keys', mode: RaidMode = 'pvp', sameProfile?: string) {
  let profile = { ...createLocalProfile('TEST', 'keys'), selectedMode: mode, ...(sameProfile ? { id: sameProfile } : {}) }
  for (const id of done) profile = setTaskProgress(profile, 'pvp', { taskId: id, status: 'completed', source: 'manual', updatedAt: '2026-11-05T00:00:00Z' })
  for (const each of ['pvp', 'pve', 'seasonal'] as const) profile.modes[each] = { ...profile.modes[each], favoriteItemIds: favorites }
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  render(<LocaleProvider><AppStateProvider><MemoryRouter initialEntries={[at]}><QuestKeysPage /></MemoryRouter></AppStateProvider></LocaleProvider>)
  return profile
}
const row = (name: string) => screen.getByText(name).closest('.quest-key') as HTMLElement
const tab = (name: RegExp) => screen.getByRole('button', { name })

describe('«Ключи для квестов»', () => {
  beforeEach(() => localStorage.clear())

  it('a key lists all its quests; a quest done leaves; the key moves to «Больше не нужны» with the last of them', () => {
    open(['q1'])
    const k1 = row('Ключ от склада')
    expect(within(k1).queryByRole('link', { name: 'Первый' })).toBeNull()
    expect(within(k1).getByRole('link', { name: 'Второй' })).toBeInTheDocument()
    expect(k1).toHaveTextContent('Выполнено: 1 из 2')
    expect(tab(/^Нужны/)).toHaveTextContent('Нужны · 2')
  })

  it('all done: only under «Больше не нужны», where its quests can be opened', () => {
    open(['q1', 'q2'])
    expect(screen.queryByText('Ключ от склада')).toBeNull()
    fireEvent.click(tab(/^Больше не нужны/))
    const k1 = row('Ключ от склада')
    expect(within(k1).getByRole('link', { name: 'Первый' })).toHaveAttribute('href', '/quests?filter=all&selected=q1')
    expect(screen.getByText(/можно убрать их из избранного в игре/)).toBeInTheDocument()
  })

  it('«Отложить» asks for how long; put aside for good, the quest no longer holds the key and comes back with «Вернуть»', () => {
    const profile = open()
    fireEvent.click(within(row('Ключ от гаража')).getByRole('button', { name: 'Отложить' }))
    const dialog = screen.getByRole('dialog')
    for (const kind of ['По времени', 'До уровня', 'Бессрочно']) expect(within(dialog).getByRole('radio', { name: kind })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Бессрочно' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отложить' }))
    expect(Object.keys(JSON.parse(localStorage.getItem(deferredQuestsKey(profile.id, 'pvp'))!))).toEqual(['q3'])
    expect(screen.queryByText('Ключ от гаража')).toBeNull()
    fireEvent.click(tab(/^Отложены/))
    const k2 = row('Ключ от гаража')
    expect(k2).toHaveTextContent('бессрочно')
    fireEvent.click(within(k2).getByRole('button', { name: 'Вернуть' }))
    expect(screen.queryByText('Ключ от гаража')).toBeNull()
    fireEvent.click(tab(/^Нужны/))
    expect(screen.getByText('Ключ от гаража')).toBeInTheDocument()
  })

  it('a key of several quests offers them all in the window, the pressed one ticked', () => {
    open()
    const k1 = row('Ключ от склада')
    fireEvent.click(within(within(k1).getByRole('link', { name: 'Второй' }).closest('li') as HTMLElement).getByRole('button', { name: 'Отложить' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('checkbox', { name: 'Первый' })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Второй' })).toBeChecked()
  })

  const star = (name: string) => within(row(name)).getByRole('button', { name: /избранн/i })

  it('a star, not a tick: it puts the key into «Избранные ключи» beside «Больше не нужны», and takes it back', () => {
    open()
    expect(screen.queryByText(/Отмечен/)).toBeNull()
    expect(within(row('Ключ от склада')).queryByRole('checkbox')).toBeNull()
    expect(tab(/^Избранные ключи/)).toHaveTextContent('Избранные ключи · 0')
    fireEvent.click(tab(/^Избранные ключи/))
    expect(screen.getByText('Нажмите звёздочку на ключе, и он будет здесь.')).toBeInTheDocument()
    fireEvent.click(tab(/^Нужны/))

    fireEvent.click(screen.getAllByRole('button', { name: 'В избранные ключи' })[0]!)
    expect(tab(/^Избранные ключи/)).toHaveTextContent('Избранные ключи · 1')
    // A star leaves the key where it was: it is needed still.
    expect(tab(/^Нужны/)).toHaveTextContent('Нужны · 2')
    const pressed = screen.getByRole('button', { name: 'Убрать из избранных ключей' })
    expect(pressed).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(tab(/^Избранные ключи/))
    expect(screen.queryByText('Ключ от склада')).toBeNull()
    expect(screen.getByText('Ключ от гаража')).toBeInTheDocument()
    fireEvent.click(star('Ключ от гаража'))
    expect(tab(/^Избранные ключи/)).toHaveTextContent('Избранные ключи · 0')
    expect(screen.queryByText('Ключ от гаража')).toBeNull()
  })

  it('the star touches nothing else: not the favourites of the Overview and the market, not any other store', () => {
    const profile = open(['q1', 'q2'], ['ledx'])
    const others = () => Object.keys(localStorage).filter((key) => key !== questKeyFavoritesKey(profile.id, 'pvp')).sort().map((key) => [key, localStorage.getItem(key)])
    const before = others()
    expect(before.length).toBeGreaterThan(0)
    fireEvent.click(star('Ключ от гаража'))
    fireEvent.click(tab(/^Больше не нужны/))
    fireEvent.click(star('Ключ от склада'))
    expect([...readQuestKeyFavorites(profile.id, 'pvp')].sort()).toEqual(['k1', 'k2'])
    expect(others()).toEqual(before)
    const stored = JSON.parse(localStorage.getItem('tarkov-operations-profiles-v2')!) as { profiles: Array<{ modes: Record<RaidMode, { favoriteItemIds: string[] }> }> }
    for (const mode of ['pvp', 'pve', 'seasonal'] as const) expect(stored.profiles[0]!.modes[mode].favoriteItemIds).toEqual(['ledx'])
  })

  it('«Показать только избранные»: in every section but the favourites themselves, and it stays until pressed again', () => {
    localStorage.removeItem('raidos-quest-keys-only-favorites-v1')
    open()
    fireEvent.click(star('Ключ от гаража'))
    const only = () => screen.queryByRole('button', { name: 'Показать только избранные' })
    expect(screen.getByText('Ключ от склада')).toBeInTheDocument()
    fireEvent.click(only()!)
    expect(only()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Ключ от гаража')).toBeInTheDocument()
    expect(screen.queryByText('Ключ от склада')).toBeNull()
    fireEvent.click(tab(/^Больше не нужны/))
    expect(only()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('В этом разделе нет избранных ключей.')).toBeInTheDocument()
    fireEvent.click(tab(/^Отложены/))
    expect(only()).toBeInTheDocument()
    fireEvent.click(tab(/^Избранные ключи/))
    expect(only()).toBeNull()
    fireEvent.click(tab(/^Нужны/))
    fireEvent.click(only()!)
    expect(screen.getByText('Ключ от склада')).toBeInTheDocument()
    expect(localStorage.getItem('raidos-quest-keys-only-favorites-v1')).toBeNull()
  })

  it('in «Избранные ключи» those to take off come first and say so', () => {
    open(['q3'])
    fireEvent.click(star('Ключ от склада'))
    fireEvent.click(tab(/^Больше не нужны/))
    fireEvent.click(star('Ключ от гаража'))
    // Only in this tab.
    expect(within(row('Ключ от гаража')).queryByText('Больше не нужен')).toBeNull()
    fireEvent.click(tab(/^Избранные ключи/))
    expect(screen.getAllByRole('listitem').filter((item) => item.classList.contains('quest-key')).map((item) => within(item).getByText(/^Ключ от/).textContent)).toEqual(['Ключ от гаража', 'Ключ от склада'])
    expect(within(row('Ключ от гаража')).getByText('Больше не нужен')).toBeInTheDocument()
    expect(within(row('Ключ от склада')).queryByText('Больше не нужен')).toBeNull()
  })

  it('opens the tab named in the address (the message goes there)', () => {
    open([], [], '/quest-keys?tab=favorites')
    expect(tab(/^Избранные ключи/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('PvP, PvE and Season have their own stars', () => {
    const { id } = open()
    fireEvent.click(star('Ключ от склада'))
    cleanup()
    open([], [], '/quest-keys', 'pve', id)
    expect(tab(/^Избранные ключи/)).toHaveTextContent('Избранные ключи · 0')
    expect(star('Ключ от склада')).toHaveAttribute('aria-pressed', 'false')
    expect([...readQuestKeyFavorites(id, 'pvp')]).toEqual(['k1'])
  })

  it('«Включить уведомления» is off by default, and is a switch', () => {
    open()
    expect(readQuestKeyReminder()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Включить уведомления' }))
    expect(readQuestKeyReminder()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Выключить уведомления' }))
    expect(readQuestKeyReminder()).toBe(false)
  })

  it('every new text has its English', () => {
    setRenderLanguage('en')
    try {
      expect(['Избранные ключи', 'В избранные ключи', 'Убрать из избранных ключей', 'Нажмите звёздочку на ключе, и он будет здесь.', 'Больше не нужен', 'Отложен', 'Включить уведомления', 'Выключить уведомления', 'Сообщит, когда 10 и больше избранных ключей больше не нужны.'].map((text) => uiText(text)))
        .toEqual(['Favorite keys', 'Add to favorite keys', 'Remove from favorite keys', 'Press the star on a key to keep it here.', 'No longer needed', 'Put aside', 'Turn notifications on', 'Turn notifications off', 'Tells you when 10 or more favorite keys are no longer needed.'])
    } finally { setRenderLanguage('ru') }
  })

  it('the search and the map narrow the list', () => {
    open()
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск ключа или квеста…' }), { target: { value: 'третий' } })
    expect(screen.queryByText('Ключ от склада')).toBeNull()
    expect(screen.getByText('Ключ от гаража')).toBeInTheDocument()
  })

  // Owner, 07.11.2026: «ключи, которые у меня есть, будет писаться… ниже. И рядом пишется и есть в игре»; «Ключи в схроне»… «Добавить вручную».
  it('a key the player has: «Есть в игре», below the others, counted on «Нужны»; «Ключи в схроне» adds one by hand', () => {
    const profile = open()
    act(() => setOwnedKey(profile.id, 'pvp', 'k1', 1))
    const k1 = row('Ключ от склада')
    expect(k1).toHaveTextContent('Есть в игре')
    expect(row('Ключ от гаража')).not.toHaveTextContent('Есть в игре')
    const order = [...document.querySelectorAll('.quest-key strong')].map((node) => node.textContent)
    expect(order.indexOf('Ключ от гаража')).toBeLessThan(order.indexOf('Ключ от склада'))
    expect(tab(/^Нужны/)).toHaveTextContent('Нужны · 2 · есть 1')
    fireEvent.click(screen.getByRole('button', { name: /^Ключи в схроне/ }))
    const dialog = screen.getByRole('dialog', { name: 'Ключи в схроне' })
    expect(within(dialog).getByText('Ключ от склада')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить вручную' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Название ключа…' }), { target: { value: 'гараж' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Ключ от гаража/ }))
    expect(readOwnedKeys(profile.id, 'pvp').get('k2')).toBe(1)
  })

  it('the «?» beside «Найти ключи» says to open the container or bag with all the keys', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Как работает «Найти ключи»' }))
    expect(screen.getByRole('dialog', { name: 'Как работает «Найти ключи»' })).toHaveTextContent('откройте контейнер или сумку, где у вас лежат все ключи')
  })
})
