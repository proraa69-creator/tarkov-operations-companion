import { useMemo, useState } from 'react'
import { Check, Minus, Plus, Search, Warehouse } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { usesDataGateway } from '../data/tarkovApi'
import type { HideoutStation, Item } from '../domain/types'
import { hideoutNeeds, type HideoutNeed } from '../hideout/hideoutNeeds'
import { setHideoutFound, useHideoutFound } from '../hideout/hideoutFound'
import '../styles/hideoutStash.css'

/** An item's inventory picture (the grid image our server mirrors; tarkov.dev's own name in development). */
function gridPicture(id: string) {
  return usesDataGateway() ? `https://raidos.app/v1/item-images/${id}-grid.webp` : `https://assets.tarkov.dev/${id}-grid-image.webp`
}
const roman = (level: number) => ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'][level] ?? String(level)
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value)
/** Cells an item takes in the stash: its real size, capped so a rifle case does not take a whole row. */
const span = (value: number | undefined, max: number) => Math.min(max, Math.max(1, value ?? 1))

/**
 * «Убежище» (owner, 17.10.2026): what the hideout still needs, laid out like the game's stash — every item at its own
 * size in cells with its picture, how many are still to find, the found-in-raid mark and «+» / «−». The stations on the
 * left: the level built (per profile and mode) takes its requirements off the stash; a station picked shows only its items.
 */
export function HideoutStashPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const profileId = state.activeProfile.id
  const mode = state.raidMode
  const built = state.activeProfile.modes[mode].hideoutLevels
  const found = useHideoutFound(profileId, mode)
  const [station, setStation] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [firOnly, setFirOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const stations = useMemo(() => [...data.hideout].filter((entry) => entry.levels?.length).sort((a, b) => a.name.localeCompare(b.name, 'ru')), [data.hideout])
  const needs = useMemo(() => hideoutNeeds(stations, built, found, station ?? undefined), [stations, built, found, station])
  const everything = useMemo(() => station ? hideoutNeeds(stations, built, found) : needs, [station, stations, built, found, needs])

  const needle = query.trim().toLowerCase()
  const visible = needs.items.filter((need) => {
    const item = items.get(need.itemId)
    if (firOnly && !need.foundInRaid) return false
    return !needle || Boolean(item && (item.name.toLowerCase().includes(needle) || item.shortName.toLowerCase().includes(needle)))
  })
  // Still to find first, the biggest first (they pack the grid like a real stash); the collected ones after.
  const size = (need: HideoutNeed) => span(items.get(need.itemId)?.width, 3) * span(items.get(need.itemId)?.height, 3)
  const open = visible.filter((need) => need.remaining > 0).sort((a, b) => size(b) - size(a) || b.remaining - a.remaining)
  const done = visible.filter((need) => need.remaining === 0)
  const selected = needs.items.find((need) => need.itemId === selectedId) ?? everything.items.find((need) => need.itemId === selectedId)
  const share = everything.total ? (everything.total - everything.remaining) / everything.total : 0

  return <div className="page hideout-stash">
    <header className="page-header hs-header">
      <div>
        <div className="eyebrow">{uiText('Убежище · ')}{mode === 'seasonal' ? uiText('Сезон') : mode.toUpperCase()}</div>
        <h1 className="page-title">{uiText('Что собрать для убежища')}</h1>
        <p className="page-subtitle">{uiText('Все предметы на уровни, которые ещё не построены. Отметьте построенные уровни слева, найденное — кнопками «+» и «−».')}</p>
      </div>
      <div className="hs-progress" aria-label={uiText('Собрано')}>
        <div className="hs-progress-numbers"><strong>{number(everything.total - everything.remaining)}</strong><span> / {number(everything.total)}</span></div>
        <div className="hs-progress-bar"><span style={{ transform: `scaleX(${share})` }} /></div>
        <div className="hs-money">
          {everything.money.roubles > 0 && <span>{number(everything.money.roubles)} ₽</span>}
          {everything.money.dollars > 0 && <span>{number(everything.money.dollars)} $</span>}
          {everything.money.euros > 0 && <span>{number(everything.money.euros)} €</span>}
        </div>
      </div>
    </header>

    <div className="hs-layout">
      <aside className="panel hs-stations" aria-label={uiText('Модули')}>
        <h3><Warehouse size={13} aria-hidden="true" /> {uiText('Модули')}</h3>
        <button type="button" className={`hs-station is-all${station === null ? ' is-active' : ''}`} onClick={() => setStation(null)}>
          <span className="hs-station-name">{uiText('Все модули')}</span>
          <span className="hs-station-left">{number(everything.remaining)}</span>
        </button>
        {stations.map((entry) => <StationRow key={entry.id} station={entry} level={built[entry.id] ?? 0} active={station === entry.id}
          left={hideoutNeeds([entry], built, found).remaining}
          onPick={() => setStation(station === entry.id ? null : entry.id)}
          onLevel={(level) => state.setHideoutLevel(entry.id, level)} />)}
      </aside>

      <section className="hs-stash-wrap">
        <div className="hs-toolbar">
          <label className="hs-search"><Search size={14} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти предмет…')} aria-label={uiText('Найти предмет')} /></label>
          <button type="button" className={`hs-chip${firOnly ? ' is-active' : ''}`} aria-pressed={firOnly} onClick={() => setFirOnly((value) => !value)}><Check size={12} aria-hidden="true" /> {uiText('Только «найдено в рейде»')}</button>
          <span className="hs-count">{uiText('Осталось')}: <strong>{number(needs.remaining)}</strong> {uiText('шт.')} · {open.length} {uiText('поз.')}</span>
        </div>
        <div className="hs-stash" role="list" aria-label={uiText('Тайник')}>
          {open.map((need) => <StashItem key={need.itemId} need={need} item={items.get(need.itemId)} selected={need.itemId === selectedId} onSelect={() => setSelectedId(need.itemId)} profileId={profileId} />)}
        </div>
        {done.length > 0 && <>
          <h3 className="hs-done-title"><Check size={13} aria-hidden="true" /> {uiText('Собрано')} · {done.length}</h3>
          <div className="hs-stash is-done" role="list" aria-label={uiText('Собрано')}>
            {done.map((need) => <StashItem key={need.itemId} need={need} item={items.get(need.itemId)} selected={need.itemId === selectedId} onSelect={() => setSelectedId(need.itemId)} profileId={profileId} />)}
          </div>
        </>}
        {!open.length && !done.length && <p className="dim hs-empty">{uiText(needle || firOnly ? 'Ничего не нашлось' : 'Всё построено — убежищу больше ничего не нужно')}</p>}
      </section>

      <aside className="panel hs-detail" aria-live="polite">
        {selected ? <ItemDetail need={selected} item={items.get(selected.itemId)} profileId={profileId} /> : <p className="dim">{uiText('Выберите предмет в тайнике — здесь будет, куда он нужен.')}</p>}
      </aside>
    </div>
  </div>
}

function StationRow({ station, level, active, left, onPick, onLevel }: { station: HideoutStation; level: number; active: boolean; left: number; onPick: () => void; onLevel: (level: number) => void }) {
  const max = station.levels?.length ?? 0
  return <div className={`hs-station${active ? ' is-active' : ''}${left === 0 ? ' is-complete' : ''}`}>
    <button type="button" className="hs-station-pick" onClick={onPick} aria-pressed={active}>
      {station.imageUrl ? <img src={station.imageUrl} alt="" /> : <span className="hs-station-dot" />}
      <span className="hs-station-name">{station.name}</span>
      <span className="hs-station-left">{left > 0 ? number(left) : <Check size={12} aria-label={uiText('Всё собрано')} />}</span>
    </button>
    <div className="hs-levels" role="group" aria-label={`${uiText('Построенный уровень')}: ${station.name}`}>
      {Array.from({ length: max + 1 }, (_, index) => index).map((value) => (
        <button key={value} type="button" className={`hs-level${value <= level && value > 0 ? ' is-built' : ''}${value === level ? ' is-current' : ''}`} aria-pressed={value === level}
          title={value === 0 ? uiText('Не построен') : `${uiText('Построен уровень')} ${roman(value)}`} onClick={() => onLevel(value)}>
          {value === 0 ? '·' : roman(value)}
        </button>
      ))}
    </div>
  </div>
}

function StashItem({ need, item, selected, onSelect, profileId }: { need: HideoutNeed; item?: Item; selected: boolean; onSelect: () => void; profileId: string }) {
  const { raidMode } = useAppState()
  const w = span(item?.width, 3)
  const h = span(item?.height, 3)
  const change = (delta: number) => setHideoutFound(profileId, raidMode, need.itemId, need.found + delta, need.total)
  return <div role="listitem" className={`hs-item${selected ? ' is-selected' : ''}${need.remaining === 0 ? ' is-done' : ''}`} style={{ gridColumn: `span ${w}`, gridRow: `span ${h}` }}>
    <button type="button" className="hs-item-face" onClick={onSelect} title={item?.name ?? need.itemId}>
      <img src={gridPicture(need.itemId)} alt="" loading="lazy" decoding="async" onError={(event) => { if (item?.iconUrl && event.currentTarget.src !== item.iconUrl) event.currentTarget.src = item.iconUrl }} />
      <span className="hs-item-name">{item?.shortName ?? '?'}</span>
      {need.foundInRaid && <span className="hs-item-fir" title={uiText('Нужен найденный в рейде')}><Check size={10} strokeWidth={3} /></span>}
      <span className="hs-item-count">{need.remaining > 0 ? `×${need.remaining}` : <Check size={12} strokeWidth={3} />}</span>
    </button>
    <div className="hs-item-controls">
      <button type="button" onClick={() => change(-1)} disabled={need.found <= 0} aria-label={`${uiText('Минус один')}: ${item?.name ?? ''}`}><Minus size={12} /></button>
      <span>{need.found}/{need.total}</span>
      <button type="button" onClick={() => change(1)} disabled={need.remaining <= 0} aria-label={`${uiText('Найден ещё один')}: ${item?.name ?? ''}`}><Plus size={12} /></button>
    </div>
  </div>
}

function ItemDetail({ need, item, profileId }: { need: HideoutNeed; item?: Item; profileId: string }) {
  const { raidMode } = useAppState()
  const set = (value: number) => setHideoutFound(profileId, raidMode, need.itemId, value, need.total)
  return <div className="hs-detail-body">
    <div className="hs-detail-picture"><img src={gridPicture(need.itemId)} alt="" onError={(event) => { if (item?.iconUrl) event.currentTarget.src = item.iconUrl }} /></div>
    <h3>{item?.name ?? need.itemId}</h3>
    {need.foundInRaid && <span className="tag green"><Check size={11} /> {uiText('найден в рейде')}</span>}
    <div className="hs-detail-counter">
      <button type="button" className="icon-button" onClick={() => set(need.found - 1)} disabled={need.found <= 0} aria-label={uiText('Минус один')}><Minus size={16} /></button>
      <div><strong>{need.found}</strong><span> / {need.total}</span><small>{need.remaining > 0 ? `${uiText('осталось')} ${need.remaining}` : uiText('собрано')}</small></div>
      <button type="button" className="icon-button" onClick={() => set(need.found + 1)} disabled={need.remaining <= 0} aria-label={uiText('Найден ещё один')}><Plus size={16} /></button>
    </div>
    <button type="button" className="button small ghost" onClick={() => set(need.remaining > 0 ? need.total : 0)}>{uiText(need.remaining > 0 ? 'Собрано всё' : 'Сбросить')}</button>
    <h4>{uiText('Куда нужен')}</h4>
    <ul className="hs-uses">
      {need.uses.map((use) => <li key={`${use.stationId}-${use.level}`}><span>{use.stationName}</span><span className="hs-use-level">{roman(use.level)}</span><strong>×{use.count}</strong>{use.foundInRaid && <Check size={11} className="hs-use-fir" aria-label={uiText('найден в рейде')} />}</li>)}
    </ul>
    {item?.fleaPrice ? <p className="dim hs-detail-price">{uiText('Барахолка')}: {number(item.fleaPrice)} ₽ {uiText('за шт.')}</p> : null}
  </div>
}
