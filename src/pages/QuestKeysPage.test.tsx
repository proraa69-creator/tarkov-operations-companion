import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import type { Item, Quest, RaidMode } from '../domain/types'
import { deferredQuestsKey } from '../progression/deferredQuests'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage, uiText } from '../i18n/renderText'
import { questKeyFavoritesKey, readQuestKeyFavorites, readQuestKeyReminder } from '../quests/questKeyFavorites'
import { AppStateProvider } from '../state/AppState'
import { readOwnedKeys, setOwnedKey } from '../quests/ownedKeys'
import { readUnsureKeys, writeUnsureKeys } from '../quests/unsureKeys'

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
  // Owner, 27.11.2026: «нам не нужна кнопка «Изменить ключи в схроне». Ее убери».
  it('a key the player has: «Есть в схроне», the others «Нет в наличии», below the others, counted on «Нужны»; «Ключи в схроне» shows only those, with no «Изменить ключи в схроне»', () => {
    const profile = open()
    // nothing said before any key is found or added
    expect(row('Ключ от гаража')).not.toHaveTextContent('Нет в наличии')
    act(() => setOwnedKey(profile.id, 'pvp', 'k1', 1))
    const k1 = row('Ключ от склада')
    expect(k1).toHaveTextContent('Есть в схроне')
    expect(row('Ключ от гаража')).toHaveTextContent('Нет в наличии')
    const order = [...document.querySelectorAll('.quest-key strong')].map((node) => node.textContent)
    expect(order.indexOf('Ключ от гаража')).toBeLessThan(order.indexOf('Ключ от склада'))
    expect(tab(/^Нужны/)).toHaveTextContent('Нужны · 2 · есть 1')
    // owner, 11.11.2026: a filter beside «Найти ключи», not a window
    const stash = screen.getByRole('button', { name: /^Ключи в схроне/ })
    fireEvent.click(stash)
    expect(stash).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('dialog', { name: 'Ключи в схроне' })).toBeNull()
    expect([...document.querySelectorAll('.quest-key strong')].map((node) => node.textContent)).toEqual(['Ключ от склада'])
    expect(screen.queryByRole('button', { name: /Изменить ключи в схроне|Свернуть/ })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Ключи в схроне' })).toBeNull()
    fireEvent.click(stash)
    expect(document.querySelectorAll('.quest-key')).toHaveLength(2)
  })

  // Owner, 27.11.2026: «ключи должны сразу, вот нашлись и сразу добавляются. Только не добавляются ключи под вопросом… после конца
  // сканирования открывается это окно автоматически… выбираешь какой надо и нажимаешь галочку… снизу будет галочка «Ок». При
  // нажатии ее тебя переносит блок «Ключи в схроне»».
  describe('«Ключи под вопросом»', () => {
    const cabin = { id: 'k-cabin', name: 'Ключ от времянки', shortName: 'Времянка', category: 'Ключ', iconUrl: 'cabin.webp' } as unknown as Item
    const trailer = { id: 'k-trailer', name: 'Ключ от времянки трейлерного парка', shortName: 'Времянка', category: 'Ключ', iconUrl: 'trailer.webp' } as unknown as Item
    const safe1 = { id: 'k-safe-1', name: 'Ключ от сейфа в офисе', shortName: 'Сейф', category: 'Ключ' } as unknown as Item
    const safe2 = { id: 'k-safe-2', name: 'Ключ от сейфа на складе', shortName: 'Сейф', category: 'Ключ' } as unknown as Item
    const unsureButton = () => screen.queryByRole('button', { name: /^Ключи под вопросом/ })
    const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    beforeEach(() => { data.items.push(cabin, trailer, safe1, safe2) })
    afterEach(() => {
      data.items.splice(-4)
      delete window.tarkovDesktop
      if (scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView)
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    })

    it('a scan adds the keys told at once; at its end the window opens by itself; the ticked keys and pieces go to «Ключи в схроне»', async () => {
      let calls = 0
      // each label once per scan (electron/collectorScan.ts): «Времянка» twice, «Склад» once
      window.tarkovDesktop = { scanScreenText: async () => ({ gameWindow: true, text: calls++ ? '' : 'Склад\nВремянка\nВремянка' }) } as unknown as NonNullable<Window['tarkovDesktop']>
      const scrolled = vi.fn()
      Element.prototype.scrollIntoView = scrolled
      const profile = open()
      expect(unsureButton()).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Найти ключи' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Остановить поиск' }))
      const dialog = await screen.findByRole('dialog', { name: 'Ключи под вопросом' }, { timeout: 3000 })
      // «Склад» is in the stash already; «Времянка» is not, nor any of its keys
      expect(readOwnedKeys(profile.id, 'pvp')).toEqual(new Map([['k1', 1]]))
      expect(dialog).toHaveTextContent('Найдены ключи с одинаковыми названиями — выберите правильный ключ.')
      expect(dialog).toHaveTextContent('«Времянка» ×2')
      expect([...dialog.querySelectorAll('.quest-keys-unsure-keys img')].map((img) => img.getAttribute('src'))).toEqual(['cabin.webp', 'trailer.webp'])
      const tick = (name: string) => within(dialog).getByRole('checkbox', { name })
      expect(tick('Ключ от времянки')).not.toBeChecked()
      expect(tick('Ключ от времянки трейлерного парка')).not.toBeChecked()
      // the first tick takes both cells seen; one less; the second takes the cell left
      fireEvent.click(tick('Ключ от времянки трейлерного парка'))
      expect(tick('Ключ от времянки трейлерного парка').closest('li')).toHaveTextContent('×2')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Минус один: Ключ от времянки трейлерного парка' }))
      fireEvent.click(tick('Ключ от времянки'))
      expect(tick('Ключ от времянки').closest('li')).toHaveTextContent('×1')
      expect(readOwnedKeys(profile.id, 'pvp').has('k-cabin')).toBe(false)
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ок' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(readOwnedKeys(profile.id, 'pvp')).toEqual(new Map([['k1', 1], ['k-cabin', 1], ['k-trailer', 1]]))
      // carried to «Ключи в схроне», the whole stash
      expect(screen.getByRole('button', { name: /^Ключи в схроне/ })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Все ключи · 3' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('region', { name: 'Не нужны для квестов' })).toHaveTextContent('Ключ от времянки трейлерного парка')
      expect(scrolled).toHaveBeenCalled()
      expect(unsureButton()).toBeNull()
    })

    it('the button: only while labels wait, orange; «Убрать» drops a label, «Ок» keeps the one without a tick; PvE apart', () => {
      const profile = open()
      expect(unsureButton()).toBeNull()
      act(() => writeUnsureKeys(profile.id, 'pvp', new Map([['Времянка', { ids: ['k-cabin', 'k-trailer'], seen: 1 }], ['Сейф', { ids: ['k-safe-1', 'k-safe-2'], seen: 1 }]])))
      expect(unsureButton()).toHaveTextContent('Ключи под вопросом · 2')
      expect(unsureButton()).toHaveClass('quest-keys-unsure')
      // not opened by itself without a scan
      expect(screen.queryByRole('dialog')).toBeNull()
      fireEvent.click(unsureButton()!)
      const dialog = screen.getByRole('dialog', { name: 'Ключи под вопросом' })
      // one cell read says no count
      expect(dialog).toHaveTextContent('«Времянка»')
      expect(dialog).not.toHaveTextContent('«Времянка» ×')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Убрать: «Сейф»' }))
      expect(dialog).not.toHaveTextContent('Сейф')
      expect([...readUnsureKeys(profile.id, 'pvp').keys()]).toEqual(['Времянка'])
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ок' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(readOwnedKeys(profile.id, 'pvp').size).toBe(0)
      expect(unsureButton()).toHaveTextContent('Ключи под вопросом · 1')
      // closed without «Ок»: nothing changes
      fireEvent.click(unsureButton()!)
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Ключ от времянки' }))
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(readOwnedKeys(profile.id, 'pvp').size).toBe(0)
      cleanup()
      open([], [], '/quest-keys', 'pve', profile.id)
      expect(unsureButton()).toBeNull()
    })

    it('blinks softly, and not at all for those who turn motion off', () => {
      const css = readFileSync(resolve(process.cwd(), 'src/quests/questKeys.css'), 'utf8')
      expect(css).toMatch(/\.quest-keys-unsure \{[^}]*animation: quest-keys-unsure-glow [^;]*infinite/)
      expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.quest-keys-unsure \{ animation: none/)
    })
  })

  // A player and the owner, 27.11.2026 («пишет что у меня их 15 шт — но показывает ток ключи для квестов»; «кнопку все ключи и
  // отдельно ключи для квестов»).
  it('«Ключи в схроне»: the whole stash by default, the quests\' keys as cards and the rest below; «Для квестов» keeps the cards', () => {
    data.items.push({ id: 'k9', name: 'Ключ от времянки', shortName: 'Времянка', category: 'Ключ' } as unknown as Item)
    try {
      const profile = open()
      act(() => { setOwnedKey(profile.id, 'pvp', 'k1', 1); setOwnedKey(profile.id, 'pvp', 'k9', 2) })
      fireEvent.click(screen.getByRole('button', { name: /^Ключи в схроне/ }))
      expect(screen.getByRole('button', { name: 'Все ключи · 2' })).toHaveAttribute('aria-pressed', 'true')
      expect([...document.querySelectorAll('.quest-key strong')].map((node) => node.textContent)).toEqual(['Ключ от склада'])
      const other = screen.getByRole('region', { name: 'Не нужны для квестов' })
      expect(other).toHaveTextContent('Ключ от времянки')
      expect(other).toHaveTextContent('×2')
      fireEvent.click(screen.getByRole('button', { name: 'Для квестов · 1' }))
      expect(screen.queryByRole('region', { name: 'Не нужны для квестов' })).toBeNull()
      expect(document.querySelectorAll('.quest-key')).toHaveLength(1)
      setRenderLanguage('en')
      try {
        expect(['Все ключи', 'Для квестов', 'Не нужны для квестов'].map((text) => uiText(text))).toEqual(['All keys', 'For quests', 'Not needed for quests'])
      } finally { setRenderLanguage('ru') }
    } finally { data.items.pop() }
  })

  // Owner, 28.11.2026 (in place of «Изменить ключи в схроне»): «− ×N +» right on each key of «Ключи в схроне».
  it('«Ключи в схроне»: «−» and «+» on every key, «Все ключи» and «Для квестов»; on 0 the key leaves the stash', () => {
    data.items.push({ id: 'k9', name: 'Ключ от времянки', shortName: 'Времянка', category: 'Ключ' } as unknown as Item)
    try {
      const profile = open()
      act(() => { setOwnedKey(profile.id, 'pvp', 'k1', 1); setOwnedKey(profile.id, 'pvp', 'k2', 1); setOwnedKey(profile.id, 'pvp', 'k9', 2) })
      // not on the list of every key, only in the stash
      expect(screen.queryByRole('button', { name: /^Плюс один/ })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /^Ключи в схроне/ }))
      const plus = (name: string) => screen.getByRole('button', { name: `Плюс один: ${name}` })
      const minus = (name: string) => screen.getByRole('button', { name: `Минус один: ${name}` })
      fireEvent.click(plus('Ключ от склада'))
      expect(readOwnedKeys(profile.id, 'pvp').get('k1')).toBe(2)
      expect(row('Ключ от склада')).toHaveTextContent('×2')
      // a key no quest needs: two, one, gone from «Все ключи»
      fireEvent.click(minus('Ключ от времянки'))
      expect(screen.getByRole('region', { name: 'Не нужны для квестов' })).toHaveTextContent('×1')
      fireEvent.click(minus('Ключ от времянки'))
      expect(readOwnedKeys(profile.id, 'pvp').has('k9')).toBe(false)
      expect(screen.queryByRole('region', { name: 'Не нужны для квестов' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Все ключи · 2' })).toBeInTheDocument()
      // «Для квестов» has them too
      fireEvent.click(screen.getByRole('button', { name: 'Для квестов · 2' }))
      fireEvent.click(minus('Ключ от гаража'))
      expect(readOwnedKeys(profile.id, 'pvp').has('k2')).toBe(false)
      expect(screen.queryByText('Ключ от гаража')).toBeNull()
      // out of the stash: its quest card says «Нет в наличии»
      fireEvent.click(screen.getByRole('button', { name: /^Ключи в схроне/ }))
      expect(within(row('Ключ от гаража')).getByRole('button', { name: 'Нет в наличии' })).toBeInTheDocument()
      expect(within(row('Ключ от склада')).getByRole('button', { name: 'Есть в схроне' })).toBeInTheDocument()
    } finally { data.items.pop() }
  })

  // Owner, 18.11.2026: «Если у нас горит кнопка «Нет в наличии», на нее можно нажать… и можно нажать «Добавить в наличие»»;
  // 25.11.2026: «не открывается окно на весь экран и не притемняет, а прям там же открывается окошечко „Добавить в наличие“. И ты
  // нажимаешь „Добавить“. Все.»
  it('«Нет в наличии» opens a small box right there, nothing dimmed; its «Добавить» puts the key in the stash', () => {
    const profile = open()
    act(() => setOwnedKey(profile.id, 'pvp', 'k1', 1))
    const missing = within(row('Ключ от гаража')).getByRole('button', { name: 'Нет в наличии' })
    fireEvent.click(missing)
    const box = within(row('Ключ от гаража')).getByRole('dialog', { name: 'Добавить в наличие' })
    expect(missing).toHaveAttribute('aria-expanded', 'true')
    // In the key's own card, not a window over the page: no dimmed overlay.
    expect(document.querySelector('.registration-overlay')).toBeNull()
    expect(box).not.toHaveAttribute('aria-modal')
    expect(within(box).getByRole('button', { name: 'Добавить' })).toHaveFocus()
    fireEvent.click(within(box).getByRole('button', { name: 'Добавить' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readOwnedKeys(profile.id, 'pvp').get('k2')).toBe(1)
    expect(row('Ключ от гаража')).toHaveTextContent('Есть в схроне')
    // Closed without adding — Escape, a click elsewhere, the tag again: nothing changes.
    act(() => setOwnedKey(profile.id, 'pvp', 'k2', 0))
    const again = () => within(row('Ключ от гаража')).getByRole('button', { name: 'Нет в наличии' })
    fireEvent.click(again())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(again())
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(again())
    fireEvent.click(again())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readOwnedKeys(profile.id, 'pvp').has('k2')).toBe(false)
  })

  // Owner, 25.11.2026: «если ключ в наличии, также нажимает на это окно и нажать „Нет в наличии“»; the right button opens the box too.
  it('«Есть в схроне» opens the same small box, by the left or the right button; its «Нет в наличии» takes the key off', () => {
    const profile = open()
    act(() => { setOwnedKey(profile.id, 'pvp', 'k1', 1); setOwnedKey(profile.id, 'pvp', 'k2', 1) })
    const owned = () => within(row('Ключ от гаража')).getByRole('button', { name: 'Есть в схроне' })
    fireEvent.contextMenu(owned())
    const box = within(row('Ключ от гаража')).getByRole('dialog', { name: 'Нет в наличии' })
    expect(document.querySelector('.registration-overlay')).toBeNull()
    expect(within(box).getByRole('button', { name: 'Нет в наличии' })).toHaveFocus()
    // Closed without a choice: still in the stash.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readOwnedKeys(profile.id, 'pvp').get('k2')).toBe(1)
    fireEvent.click(owned())
    fireEvent.click(within(within(row('Ключ от гаража')).getByRole('dialog', { name: 'Нет в наличии' })).getByRole('button', { name: 'Нет в наличии' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readOwnedKeys(profile.id, 'pvp').has('k2')).toBe(false)
    expect(within(row('Ключ от гаража')).getByRole('button', { name: 'Нет в наличии' })).toBeInTheDocument()
    // and back: the right button on «Нет в наличии» opens «Добавить в наличие»
    fireEvent.contextMenu(within(row('Ключ от гаража')).getByRole('button', { name: 'Нет в наличии' }))
    fireEvent.click(within(within(row('Ключ от гаража')).getByRole('dialog', { name: 'Добавить в наличие' })).getByRole('button', { name: 'Добавить' }))
    expect(readOwnedKeys(profile.id, 'pvp').get('k2')).toBe(1)
  })

  it('the window has its English', () => {
    setRenderLanguage('en')
    try {
      expect(['Нет в наличии', 'Добавить в наличие', 'Добавить'].map((text) => uiText(text))).toEqual(['Not in stash', 'Mark as owned', 'Add'])
    } finally { setRenderLanguage('ru') }
  })

  it('the «?» beside «Найти ключи» says to open the container or bag with all the keys', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Как работает «Найти ключи»' }))
    expect(screen.getByRole('dialog', { name: 'Как работает «Найти ключи»' })).toHaveTextContent('откройте контейнер или сумку, где у вас лежат все ключи')
  })
})
