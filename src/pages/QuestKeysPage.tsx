import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BellOff, BellRing, Check, Hourglass, KeyRound, Package, ScanSearch, Search, Star, Undo2 } from 'lucide-react'
import { QuestDeferDialog, type DeferRequest } from '../components/QuestDeferDialog'
import { useTarkovData } from '../data/DataProvider'
import type { Barter } from '../data/economyApi'
import { useLivePrices, withLivePrice } from '../data/livePrices'
import { useEconomySnapshot } from '../data/useEconomy'
import type { Item, TaskProgressStatus } from '../domain/types'
import { useTraderLoyalty } from '../gunsmith/useGunsmithAccess'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { deferralTermText, restoreDeferredQuests, useDeferredQuests } from '../progression/deferredQuests'
import { setQuestKeyFavorite, useQuestKeyFavorites, useQuestKeyReminder, writeQuestKeyReminder } from '../quests/questKeyFavorites'
import { questAvailabilityOf } from '../quests/questReadModel'
import { questKeyRows, type QuestKeyRow, type QuestKeyState, type QuestKeyUse } from '../quests/questKeys'
import { QuestKeyBarterDialog, QuestKeyMarket } from '../quests/QuestKeyMarket'
import { useKeyScan } from '../quests/keyScan'
import { useKeyUses, useOwnedKeys } from '../quests/ownedKeys'
import { KeyScanHelp, OwnedKeysDialog } from '../quests/QuestKeysStash'
import { useAppState } from '../state/AppState'
import '../quests/questKeys.css'

type QuestKeyTab = QuestKeyState | 'favorites'

const TABS: Array<{ id: QuestKeyTab; label: string; empty: string }> = [
  { id: 'needed', label: 'Нужны', empty: 'Квестовые ключи больше не нужны.' },
  { id: 'deferred', label: 'Отложены', empty: 'Нет ключей только отложенных квестов.' },
  { id: 'done', label: 'Больше не нужны', empty: 'Пока нет ключей, все квесты которых выполнены.' },
  { id: 'favorites', label: 'Избранные ключи', empty: 'Нажмите звёздочку на ключе, и он будет здесь.' },
]

/** «Показать только избранные»: this device remembers it, so coming back from a quest keeps the list as it was. */
const ONLY_FAVORITES_KEY = 'raidos-quest-keys-only-favorites-v1'
function readOnlyFavorites() {
  try { return localStorage.getItem(ONLY_FAVORITES_KEY) === '1' } catch { return false }
}
function writeOnlyFavorites(on: boolean) {
  try { if (on) localStorage.setItem(ONLY_FAVORITES_KEY, '1'); else localStorage.removeItem(ONLY_FAVORITES_KEY) } catch { /* storage unavailable: for this visit only */ }
}

/** In «Избранные ключи»: those to take off come first, marked. */
const FAVORITE_ORDER: Record<QuestKeyState, number> = { done: 0, deferred: 1, needed: 2 }
const FAVORITE_TAG: Partial<Record<QuestKeyState, { label: string; tone: string }>> = {
  done: { label: 'Больше не нужен', tone: 'brass' },
  deferred: { label: 'Отложен', tone: '' },
}

const STATUS: Partial<Record<TaskProgressStatus, { label: string; tone: string }>> = {
  active: { label: 'Текущий', tone: 'brass' },
  available: { label: 'Доступен', tone: 'green' },
  locked: { label: 'Ещё не открыт', tone: '' },
}

/** «Ключи для квестов» (a player's proposal №52, owner 05.11.2026; quests/questKeys.ts). */
export function QuestKeysPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const { locale } = useLocale()
  const mode = state.raidMode
  const profileId = state.activeProfile.id
  const progress = state.activeProfile.modes[mode]
  const loyalty = useTraderLoyalty()
  const deferred = useDeferredQuests(profileId, mode, progress.playerLevel, loyalty)
  const favorites = useQuestKeyFavorites(profileId, mode)
  const reminder = useQuestKeyReminder()
  // In the address: the message of QuestKeysReminder.tsx opens «Избранные ключи», «Назад» from a quest comes back to the same tab.
  const [params, setParams] = useSearchParams()
  const tab = TABS.find(({ id }) => id === params.get('tab'))?.id ?? 'needed'
  const setTab = (id: QuestKeyTab) => setParams(id === 'needed' ? {} : { tab: id }, { replace: true })
  const [query, setQuery] = useState('')
  const [onlyFavorites, setOnlyFavorites] = useState(readOnlyFavorites)
  const [mapId, setMapId] = useState('')
  const [request, setRequest] = useState<DeferRequest | null>(null)
  // The price of each key at this minute and the barters that give it (owner, 07.11.2026: «цены постоянно обновляются»).
  const live = useLivePrices(mode)
  const economy = useEconomySnapshot(mode).data
  const [barterKey, setBarterKey] = useState<Item | null>(null)
  const closeBarter = useCallback(() => setBarterKey(null), [])
  // The keys the player has (owner, 07.11.2026: «Найти ключи… И добавь кнопку «Ключи в схроне»»): found on screen or added by hand.
  const owned = useOwnedKeys(profileId, mode)
  const uses = useKeyUses(profileId, mode)
  const [stashOpen, setStashOpen] = useState(false)
  const closeStash = useCallback(() => setStashOpen(false), [])
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const availability = useMemo(() => questAvailabilityOf(data.quests, progress), [data.quests, progress])
  const rows = useMemo(() => questKeyRows(data.quests, items, progress, availability, deferred), [data.quests, items, progress, availability, deferred])
  const mapName = (id: string) => uiText(data.maps.find((map) => map.id === id)?.name ?? id)
  const bartersByKey = useMemo(() => {
    const keys = new Set(rows.map((row) => row.item.id))
    const byKey = new Map<string, Barter[]>()
    for (const barter of economy?.barters ?? []) {
      for (const { itemId } of barter.rewardItems) if (keys.has(itemId)) byKey.set(itemId, [...(byKey.get(itemId) ?? []), barter])
    }
    return byKey
  }, [economy, rows])
  const partOf = (itemId: string, count: number) => {
    const known = items.get(itemId)
    const traded = economy?.items[itemId]
    return { id: itemId, name: known?.name ?? traded?.name ?? itemId, iconUrl: known?.iconUrl ?? traded?.iconUrl, count }
  }
  const traderOf = (traderId: string) => data.traders.find((trader) => trader.id === traderId)
  const needle = query.trim().toLowerCase()
  const matches = (row: QuestKeyRow) => (!onlyFavorites || favorites.has(row.item.id)) && (!mapId || row.mapIds.includes(mapId))
    && (!needle || [row.item.name, row.item.shortName, ...[...row.needed, ...row.deferred, ...row.done].map((use) => use.quest.name)].some((text) => uiText(text ?? '').toLowerCase().includes(needle)))
  const filtered = rows.filter(matches)
  const inTab = (id: QuestKeyTab) => filtered.filter((row) => (id === 'favorites' ? favorites.has(row.item.id) : row.state === id))
  // The keys the player has go below the ones still to get (owner: «ключи, которые у меня есть, будет писаться… ниже»).
  const shown = tab === 'favorites' ? inTab(tab).sort((left, right) => FAVORITE_ORDER[left.state] - FAVORITE_ORDER[right.state])
    : inTab(tab).sort((left, right) => Number(owned.has(left.item.id)) - Number(owned.has(right.item.id)))
  const keyScan = useKeyScan({ items: data.items, wanted: rows.map((row) => row.item.id), profileId, mode })
  const ownedNeeded = inTab('needed').filter((row) => owned.has(row.item.id)).length
  const maps =[...new Set(rows.flatMap((row) => row.mapIds))]
  const empty = TABS.find(({ id }) => id === tab)!.empty

  const deferOf = (row: QuestKeyRow, use: QuestKeyUse) => setRequest({
    item: { id: row.item.id, name: row.item.name, ...(row.item.iconUrl ? { iconUrl: row.item.iconUrl } : {}) },
    quests: row.needed.map(({ quest }) => ({ id: quest.id, name: quest.name })),
    chosen: [use.quest.id],
  })
  const questLink = (use: QuestKeyUse) => <Link to={`/quests?filter=${use.quest.kind === 'story' ? 'story' : 'all'}&selected=${encodeURIComponent(use.quest.id)}`}>{uiText(use.quest.name)}</Link>
  const questFacts = (use: QuestKeyUse) => `${uiText(use.quest.trader)}${use.quest.kind === 'story' ? '' : ` · ${locale === 'en' ? `level ${use.quest.level}` : `${use.quest.level} ур.`}`}`
  const altNames = (use: QuestKeyUse) => use.alternatives.map((id) => uiText(items.get(id)?.shortName ?? items.get(id)?.name ?? id)).join(', ')

  return <div className="page quest-keys-page">
    <header className="page-header"><div>
      <div className="eyebrow">{uiText('Квесты · ')}{uiText(mode.toUpperCase())}</div>
      <h1 className="page-title">{uiText('Ключи для квестов')}</h1>
      <p className="page-subtitle">{uiText('Ключ нужен, пока не выполнены цели, которые он открывает.')}</p>
    </div></header>
    <div className="filter-row quest-keys-filters">
      <div className="mode-switch" role="group" aria-label={uiText('Какие ключи показать')}>
        {TABS.map(({ id, label }) => <button type="button" key={id} className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{uiText(label)} · {inTab(id).length}{id === 'needed' && ownedNeeded > 0 ? <> · {uiText('есть')} {ownedNeeded}</> : null}</button>)}
      </div>
      <label className="quest-keys-search"><Search size={15} aria-hidden="true" /><input className="input" value={query} placeholder={uiText('Поиск ключа или квеста…')} aria-label={uiText('Поиск ключа или квеста…')} onChange={(event) => setQuery(event.target.value)} /></label>
      <select className="input quest-keys-map" value={mapId} aria-label={uiText('Карта')} onChange={(event) => setMapId(event.target.value)}>
        <option value="">{uiText('Все карты')}</option>
        {maps.map((id) => <option key={id} value={id}>{mapName(id)}</option>)}
      </select>
      {/* «Избранные ключи» holds nothing else, so it has no need of it. */}
      {tab !== 'favorites' && <button type="button" className={`button small quest-keys-only-favorites${onlyFavorites ? ' primary' : ''}`} aria-pressed={onlyFavorites} onClick={() => { writeOnlyFavorites(!onlyFavorites); setOnlyFavorites(!onlyFavorites) }}>
        <Star size={14} fill={onlyFavorites ? 'currentColor' : 'none'} aria-hidden="true" />{uiText('Показать только избранные')}
      </button>}
      <button type="button" className="button small quest-keys-notify" title={uiText('Сообщит, когда 10 и больше избранных ключей больше не нужны.')} onClick={() => writeQuestKeyReminder(!reminder)}>
        {reminder ? <BellOff size={14} aria-hidden="true" /> : <BellRing size={14} aria-hidden="true" />}{uiText(reminder ? 'Выключить уведомления' : 'Включить уведомления')}
      </button>
    </div>
    <div className="quest-keys-stash-row">
      {keyScan.available && <button type="button" className={`button small${keyScan.busy ? '' : ' primary'}`} onClick={() => void keyScan.run()}>
        <ScanSearch size={14} aria-hidden="true" />{uiText(keyScan.busy ? 'Остановить поиск' : 'Найти ключи')}
      </button>}
      <KeyScanHelp />
      <button type="button" className="button small" onClick={() => setStashOpen(true)}><Package size={14} aria-hidden="true" />{uiText('Ключи в схроне')} · {owned.size}</button>
      {keyScan.message && <span className="quest-keys-scan-message" role="status">{uiText(keyScan.message)}</span>}
    </div>
    {tab === 'done' && shown.length > 0 && <p className="quest-keys-note">{uiText('Эти ключи больше не нужны: можно убрать их из избранного в игре.')}</p>}
    {shown.length === 0
      ? <p className="panel quest-keys-empty">{uiText(needle || mapId ? 'Ничего не найдено.' : onlyFavorites && tab !== 'favorites' ? 'В этом разделе нет избранных ключей.' : empty)}</p>
      : <ul className="quest-keys-list">
        {shown.map((row) => {
          const starred = favorites.has(row.item.id)
          const starLabel = uiText(starred ? 'Убрать из избранных ключей' : 'В избранные ключи')
          const stateTag = tab === 'favorites' ? FAVORITE_TAG[row.state] : undefined
          return <li key={row.item.id} className="panel quest-key">
          <div className="quest-key-head">
            <span className="quest-key-picture">{row.item.iconUrl ? <img src={row.item.iconUrl} alt="" loading="lazy" /> : <KeyRound size={22} aria-hidden="true" />}</span>
            <div className="quest-key-title">
              <strong>{uiText(row.item.name)}</strong>
              {row.mapIds.length > 0 && <small>{row.mapIds.map(mapName).join(' · ')}</small>}
            </div>
            {stateTag && <span className={`tag ${stateTag.tone}`}>{uiText(stateTag.label)}</span>}
            {owned.has(row.item.id) && <span className="tag green quest-key-owned">{uiText('Есть в игре')}{row.item.keyUses && uses.has(row.item.id) ? ` · ${uses.get(row.item.id)}/${row.item.keyUses}` : ''}</span>}
            <QuestKeyMarket item={withLivePrice(row.item, mode, live)} mode={mode} barters={bartersByKey.get(row.item.id) ?? []} onBarter={() => setBarterKey(row.item)} />
            <button type="button" className={`icon-button quest-key-star${starred ? ' is-on' : ''}`} aria-pressed={starred} aria-label={starLabel} title={starLabel} onClick={() => setQuestKeyFavorite(profileId, mode, row.item.id, !starred)}><Star size={16} aria-hidden="true" /></button>
          </div>
          {row.needed.length > 0 && <ul className="quest-key-quests">{row.needed.map((use) => <li key={use.quest.id}>
            <span className="quest-key-quest">{questLink(use)}<small>{questFacts(use)}</small>{use.alternatives.length > 0 && <small>{uiText('или')}: {altNames(use)}</small>}</span>
            {use.status && STATUS[use.status] && <span className={`tag ${STATUS[use.status]!.tone}`}>{uiText(STATUS[use.status]!.label)}</span>}
            <button type="button" className="button small ghost" onClick={() => deferOf(row, use)}><Hourglass size={13} aria-hidden="true" />{uiText('Отложить')}</button>
          </li>)}</ul>}
          {row.deferred.length > 0 && <ul className="quest-key-quests is-deferred">{row.deferred.map((use) => <li key={use.quest.id}>
            <span className="quest-key-quest">{questLink(use)}<small>{deferralTermText(use.entry, locale) || uiText('бессрочно')}</small></span>
            <button type="button" className="button small ghost" onClick={() => restoreDeferredQuests(profileId, mode, [use.quest.id])}><Undo2 size={13} aria-hidden="true" />{uiText('Вернуть')}</button>
          </li>)}</ul>}
          {row.done.length > 0 && (row.state === 'done'
            ? <ul className="quest-key-quests is-done">{row.done.map((use) => <li key={use.quest.id}><span className="quest-key-quest"><Check size={13} aria-hidden="true" />{questLink(use)}</span></li>)}</ul>
            : <small className="quest-key-progress">{uiText('Выполнено')}: {row.done.length} {uiText('из')} {row.done.length + row.needed.length + row.deferred.length}</small>)}
          </li>
        })}
      </ul>}
    {request && <QuestDeferDialog request={request} onClose={() => setRequest(null)} />}
    {stashOpen && <OwnedKeysDialog items={data.items} needed={new Set(rows.filter((row) => row.state === 'needed').map((row) => row.item.id))} profileId={profileId} mode={mode} onClose={closeStash} favoriteIds={state.favoriteItemIds} />}
    {barterKey && <QuestKeyBarterDialog item={barterKey} barters={bartersByKey.get(barterKey.id) ?? []} partOf={partOf} traderOf={traderOf} loyalty={loyalty} onClose={closeBarter} />}
  </div>
}
