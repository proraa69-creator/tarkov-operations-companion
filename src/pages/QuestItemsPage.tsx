import { useMemo, useState } from 'react'
import { Check, KeyRound, Minus, PackageX, Plus, ScanSearch, Search, Target } from 'lucide-react'
import { Link } from 'react-router-dom'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { traderPortrait } from '../data/traderPortraits'
import type { Item } from '../domain/types'
import { questAvailabilityOf } from '../quests/questReadModel'
import { questNeeds, type QuestNeed } from '../quests/questItemNeeds'
import { setQuestFound, useQuestFound } from '../quests/questFound'
import { number, span, StashPicture, stashRows } from './HideoutStashPage'
import { useScreenSync } from '../stashScan/useScreenSync'
import { RemoteScanButton } from '../stashScan/RemoteScanButton'
import { UNNEEDED_PATH } from '../stashScan/unneededPath'
import '../styles/hideoutStash.css'

/**
 * «Квесты» beside «Убежище» (owner, 28.10.2026): the items the quests of this mode still ask for, laid out like
 * «Что собрать для убежища» — every item at its size with its picture, how many are left, the found-in-raid mark and
 * «+» / «−». The traders stand on the left (a trader picked shows only their quests' items); a completed quest's items
 * move down to «Собрано» by themselves (quests/questItemNeeds.ts).
 */
export function QuestItemsPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const profileId = state.activeProfile.id
  const mode = state.raidMode
  const progress = state.activeProfile.modes[mode]
  const marked = useQuestFound(profileId, mode)
  const [trader, setTrader] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [firOnly, setFirOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // One scan of the stash for Kappa, the hideout and the quests (owner, 31.10.2026; src/stashScan/screenSync.ts).
  const screenSync = useScreenSync('Синхронизация по экрану')
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const rounds = useMemo(() => new Set(data.items.filter((item) => item.category === 'Боеприпас' || item.types?.includes('ammo')).map((item) => item.id)), [data.items])
  const availability = useMemo(() => questAvailabilityOf(data.quests, progress), [data.quests, progress])
  const everything = useMemo(() => questNeeds(data.quests, progress, availability, marked, undefined, rounds), [data.quests, progress, availability, marked, rounds])
  const needs = useMemo(() => trader ? questNeeds(data.quests, progress, availability, marked, trader, rounds) : everything, [trader, data.quests, progress, availability, marked, everything, rounds])
  const traders = useMemo(() => {
    const names = [...new Set(everything.items.flatMap((need) => need.uses.map((use) => use.trader)))]
    return names.map((name) => ({ name, imageUrl: traderPortrait(data.traders.find((entry) => entry.name === name)),
      left: questNeeds(data.quests, progress, availability, marked, name, rounds).remaining }))
      .sort((a, b) => (data.traders.findIndex((entry) => entry.name === a.name) + 1 || 99) - (data.traders.findIndex((entry) => entry.name === b.name) + 1 || 99))
  }, [everything.items, data.traders, data.quests, progress, availability, marked, rounds])

  const needle = query.trim().toLowerCase()
  const visible = needs.items.filter((need) => {
    const item = items.get(need.itemId)
    if (firOnly && !need.foundInRaid) return false
    return !needle || Boolean(item && (item.name.toLowerCase().includes(needle) || item.shortName.toLowerCase().includes(needle)))
  })
  const size = (need: QuestNeed) => span(items.get(need.itemId)?.width, 3) * stashRows(items.get(need.itemId), 3)
  const open = visible.filter((need) => need.remaining > 0).sort((a, b) => size(b) - size(a) || b.remaining - a.remaining)
  const done = visible.filter((need) => need.remaining === 0)
  const selected = needs.items.find((need) => need.itemId === selectedId) ?? everything.items.find((need) => need.itemId === selectedId)
  const share = everything.total ? (everything.total - everything.remaining) / everything.total : 0

  return <div className="page hideout-stash quest-items">
    <header className="page-header hs-header">
      <div>
        <div className="eyebrow">{uiText('Квесты · ')}{mode === 'seasonal' ? uiText('Сезон') : mode.toUpperCase()}</div>
        <h1 className="page-title">{uiText('Что собрать для квестов')}</h1>
        <p className="page-subtitle">{uiText('Предметы для текущих, доступных и будущих квестов. Предметы выполненных квестов уходят вниз в «Собрано». Отложенное — кнопками «+» и «−».')}</p>
        {screenSync.available ? <div className="hs-photo-sync">
          <button type="button" className="button primary" onClick={() => void screenSync.run()} title={uiText('Откройте схрон в игре: найденное отметится в «Каппе», убежище и квестах.')}>
            <ScanSearch size={14} aria-hidden="true" />{uiText(screenSync.busy ? ` Остановить (${screenSync.passes})` : ' Синхронизация по экрану')}
          </button>
          {/* «Не нужные предметы» beside the sync (owner, 31.10.2026): a page of its own (stashScan/UnneededItems.tsx). */}
          <Link to={UNNEEDED_PATH} className="button ghost hs-unneeded-link"><PackageX size={14} aria-hidden="true" />{uiText('Не нужные предметы')}</Link>
        </div> : <><RemoteScanButton /><div className="hs-photo-sync"><Link to={UNNEEDED_PATH} className="button ghost hs-unneeded-link"><PackageX size={14} aria-hidden="true" />{uiText('Не нужные предметы')}</Link></div></>}
        {screenSync.message && <p className="hs-sync-message" role="status">{uiText(screenSync.message)}</p>}
      </div>
      <div className="hs-progress" aria-label={uiText('Собрано')}>
        <div className="hs-progress-numbers"><strong>{number(everything.total - everything.remaining)}</strong><span> / {number(everything.total)}</span></div>
        <div className="hs-progress-bar"><span style={{ transform: `scaleX(${share})` }} /></div>
      </div>
    </header>

    <div className="hs-layout">
      <aside className="panel hs-stations" aria-label={uiText('Торговцы')}>
        <h3><Target size={13} aria-hidden="true" /> {uiText('Торговцы')}</h3>
        <button type="button" className={`hs-station is-all${trader === null ? ' is-active' : ''}`} onClick={() => setTrader(null)}>
          <span className="hs-station-name">{uiText('Все квесты')}</span>
          <span className="hs-station-left">{number(everything.remaining)}</span>
        </button>
        {traders.map((entry) => <div key={entry.name} className={`hs-station${trader === entry.name ? ' is-active' : ''}${entry.left === 0 ? ' is-complete' : ''}`}>
          <button type="button" className="hs-station-pick" onClick={() => setTrader(trader === entry.name ? null : entry.name)} aria-pressed={trader === entry.name}>
            {entry.imageUrl ? <img src={entry.imageUrl} alt="" /> : <span className="hs-station-dot" />}
            <span className="hs-station-name">{uiText(entry.name)}</span>
            <span className="hs-station-left">{entry.left > 0 ? number(entry.left) : <Check size={12} aria-label={uiText('Всё собрано')} />}</span>
          </button>
        </div>)}
      </aside>

      <section className="hs-stash-wrap">
        <div className="hs-toolbar">
          <label className="hs-search"><Search size={14} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти предмет…')} aria-label={uiText('Найти предмет')} /></label>
          <button type="button" className={`hs-chip${firOnly ? ' is-active' : ''}`} aria-pressed={firOnly} onClick={() => setFirOnly((value) => !value)}><Check size={12} aria-hidden="true" /> {uiText('Только «найдено в рейде»')}</button>
          <span className="hs-count">{uiText('Осталось')}: <strong>{number(needs.remaining)}</strong> {uiText('шт.')} · {open.length} {uiText('поз.')}</span>
        </div>
        <div className="hs-stash" role="list" aria-label={uiText('Тайник')}>
          {open.map((need) => <QuestStashItem key={need.itemId} need={need} item={items.get(need.itemId)} selected={need.itemId === selectedId} onSelect={() => setSelectedId(need.itemId)} profileId={profileId} />)}
        </div>
        {done.length > 0 && <>
          <h3 className="hs-done-title"><Check size={13} aria-hidden="true" /> {uiText('Собрано')} · {done.length}</h3>
          <div className="hs-stash is-done" role="list" aria-label={uiText('Собрано')}>
            {done.map((need) => <QuestStashItem key={need.itemId} need={need} item={items.get(need.itemId)} selected={need.itemId === selectedId} onSelect={() => setSelectedId(need.itemId)} profileId={profileId} />)}
          </div>
        </>}
        {!open.length && !done.length && <p className="dim hs-empty">{uiText(needle ? 'Ничего не нашлось' : firOnly ? 'Оставшимся квестам не нужны предметы «найдено в рейде»' : 'Квестам больше ничего не нужно')}</p>}
      </section>

      <aside className="panel hs-detail" aria-live="polite">
        {selected ? <QuestItemDetail need={selected} item={items.get(selected.itemId)} profileId={profileId} /> : <p className="dim">{uiText('Выберите предмет — здесь будет, для каких квестов он нужен.')}</p>}
      </aside>
    </div>
  </div>
}

function QuestStashItem({ need, item, selected, onSelect, profileId }: { need: QuestNeed; item?: Item; selected: boolean; onSelect: () => void; profileId: string }) {
  const { raidMode } = useAppState()
  const w = span(item?.width, 3)
  const h = stashRows(item, 3)
  const doneCount = need.uses.filter((use) => use.done).reduce((sum, use) => sum + use.count, 0)
  const own = need.found - doneCount
  const change = (delta: number) => setQuestFound(profileId, raidMode, need.itemId, own + delta, need.total - doneCount)
  return <div role="listitem" className={`hs-item${selected ? ' is-selected' : ''}${need.remaining === 0 ? ' is-done' : ''}`} style={{ gridColumn: `span ${w}`, gridRow: `span ${h}` }}>
    <button type="button" className="hs-item-face" onClick={onSelect} title={item?.name ?? need.itemId}>
      <StashPicture id={need.itemId} item={item} />
      <span className="hs-item-name">{item?.shortName ?? '?'}</span>
      {need.foundInRaid && <span className="hs-item-fir" title={uiText('Нужен найденный в рейде')}><Check size={10} strokeWidth={3} /></span>}
      {need.key && <span className="hs-item-key" title={uiText('Ключ: взять с собой')}><KeyRound size={10} /></span>}
      <span className="hs-item-count">{need.remaining > 0 ? `×${need.remaining}` : <Check size={12} strokeWidth={3} />}</span>
    </button>
    <div className="hs-item-controls">
      <button type="button" onClick={() => change(-1)} disabled={own <= 0} aria-label={`${uiText('Минус один')}: ${item?.name ?? ''}`}><Minus size={12} /></button>
      <span>{need.found}/{need.total}</span>
      <button type="button" onClick={() => change(1)} disabled={need.remaining <= 0} aria-label={`${uiText('Найден ещё один')}: ${item?.name ?? ''}`}><Plus size={12} /></button>
    </div>
  </div>
}

function QuestItemDetail({ need, item, profileId }: { need: QuestNeed; item?: Item; profileId: string }) {
  const { raidMode } = useAppState()
  const doneCount = need.uses.filter((use) => use.done).reduce((sum, use) => sum + use.count, 0)
  const own = need.found - doneCount
  const set = (value: number) => setQuestFound(profileId, raidMode, need.itemId, value, need.total - doneCount)
  return <div className="hs-detail-body">
    <div className="hs-detail-picture"><StashPicture id={need.itemId} item={item} lazy={false} /></div>
    <h3>{item?.name ?? need.itemId}</h3>
    {need.foundInRaid && <span className="tag green"><Check size={11} /> {uiText('найден в рейде')}</span>}
    {need.key && <span className="tag"><KeyRound size={11} /> {uiText('ключ — взять с собой')}</span>}
    <div className="hs-detail-counter">
      <button type="button" className="icon-button" onClick={() => set(own - 1)} disabled={own <= 0} aria-label={uiText('Минус один')}><Minus size={16} /></button>
      <div><strong>{need.found}</strong><span> / {need.total}</span><small>{need.remaining > 0 ? `${uiText('осталось')} ${need.remaining}` : uiText('собрано')}</small></div>
      <button type="button" className="icon-button" onClick={() => set(own + 1)} disabled={need.remaining <= 0} aria-label={uiText('Найден ещё один')}><Plus size={16} /></button>
    </div>
    <h4>{uiText('Для каких квестов')}</h4>
    <ul className="hs-uses">
      {need.uses.map((use) => <li key={use.stationId} className={use.done ? 'is-done' : undefined}>
        <Link to={`/quests?selected=${encodeURIComponent(use.stationId)}&filter=all`}>{uiText(use.stationName)}</Link>
        <span className="hs-use-level">{uiText(use.trader)}</span>
        <strong>{use.done ? <Check size={12} aria-label={uiText('выполнен')} /> : `×${use.count}`}</strong>
        {use.foundInRaid && !use.done && <Check size={11} className="hs-use-fir" aria-label={uiText('найден в рейде')} />}
      </li>)}
    </ul>
    {item?.fleaPrice ? <p className="dim hs-detail-price">{uiText('Барахолка')}: {number(item.fleaPrice)} ₽ {uiText('за шт.')}</p> : null}
  </div>
}
