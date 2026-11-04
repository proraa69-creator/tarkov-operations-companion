import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import type { Item, RaidMode } from '../domain/types'
import { displayPrice } from '../domain/itemPrices'
import { formatPrice } from '../shared/format'
import { circleRows, circleTime, exchangeRewards, stackCount, type CircleExchange, type CircleRow, type CircleStack } from '../hideout/cultistCircle'
import { hideoutNeeds } from '../hideout/hideoutNeeds'
import { useHideoutFound } from '../hideout/hideoutFound'
import { withSeasonFoundInRaid } from '../hideout/seasonFoundInRaid'
import { questAvailabilityOf } from '../quests/questReadModel'
import { questNeeds } from '../quests/questItemNeeds'
import { StashPicture } from './HideoutStashPage'
import '../styles/cultistCircle.css'

type Locale = 'ru' | 'en'
/** A quest or a hideout level that still wants the item. */
interface CircleNeed { key: string; label: string }

const fleaPrice = (item: Item | undefined, mode: RaidMode) => {
  const price = displayPrice(item, mode)
  return price?.kind === 'flea' ? price.price : undefined
}

/**
 * «Круг сектантов» in «Убежище и квесты» (owner, 04.11.2026): the items the circle surely gives
 * (hideout/cultistCircle.ts). A click shows what to place for one, what it costs on this mode's flea market (owner: «ты
 * знаешь что это можно купить на барахолке и загнать на круг») and which current or available quests and which hideout levels
 * of this mode still want it.
 */
export function CultistCirclePage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const { locale } = useLocale()
  const mode = state.raidMode
  const progress = state.activeProfile.modes[mode]
  const found = useHideoutFound(state.activeProfile.id, mode)
  const [query, setQuery] = useState('')
  const [neededOnly, setNeededOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const needs = useMemo(() => {
    const byItem = new Map<string, CircleNeed[]>()
    const add = (itemId: string, need: CircleNeed) => byItem.set(itemId, [...(byItem.get(itemId) ?? []), need])
    // Quests the player can act on now: a quest far down a chain would mark almost the whole list.
    const availability = questAvailabilityOf(data.quests, progress)
    for (const need of questNeeds(data.quests, progress, availability, new Map()).items) {
      for (const use of need.uses) {
        const status = availability.get(use.stationId)?.status
        if (!use.done && (status === 'active' || status === 'available')) add(need.itemId, { key: `quest:${use.stationId}`, label: use.stationName })
      }
    }
    const stations = withSeasonFoundInRaid(data.hideout.filter((station) => station.levels?.length), mode)
    for (const need of hideoutNeeds(stations, progress.hideoutLevels, found).items) {
      if (need.remaining <= 0) continue
      for (const use of need.uses) add(need.itemId, { key: `hideout:${use.stationId}:${use.level}`, label: `${use.stationName} · ${locale === 'en' ? 'level' : 'ур.'} ${use.level}` })
    }
    return byItem
  }, [data.quests, data.hideout, progress, found, mode, locale])
  const rows = useMemo(() => {
    const name = (row: CircleRow) => uiText(items.get(row.itemId)?.name ?? '')
    return circleRows((id) => items.has(id)).sort((a, b) => Number(needs.has(b.itemId)) - Number(needs.has(a.itemId)) || name(a).localeCompare(name(b), locale))
  }, [items, needs, locale])
  const needle = query.trim().toLowerCase()
  const visible = rows.filter((row) => {
    if (neededOnly && !needs.has(row.itemId)) return false
    const item = items.get(row.itemId)!
    return !needle || [item.name, item.shortName, uiText(item.name), uiText(item.shortName)].some((text) => text.toLowerCase().includes(needle))
  })
  const selected = rows.find((row) => row.itemId === selectedId)

  return <div className="page cultist-circle">
    <header className="page-header">
      <div>
        <div className="eyebrow">{uiText('Убежище · ')}{mode === 'seasonal' ? uiText('Сезон') : mode.toUpperCase()}</div>
        <h1 className="page-title">{uiText('Круг сектантов')}</h1>
        <p className="page-subtitle">{uiText('Предметы, которые выпадают всегда. Нажмите на предмет, чтобы увидеть, что положить в круг.')}</p>
      </div>
    </header>
    <div className="hs-toolbar">
      <label className="hs-search"><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти предмет…')} aria-label={uiText('Найти предмет…')} /></label>
      <button type="button" className={`hs-chip${neededOnly ? ' is-active' : ''}`} aria-pressed={neededOnly} onClick={() => setNeededOnly((value) => !value)}>{uiText('Нужно для квестов и убежища')}</button>
    </div>
    {visible.length > 0
      ? <div className="circle-grid">{visible.map((row) => <CircleTile key={row.itemId} row={row} item={items.get(row.itemId)!} needed={needs.has(row.itemId)} locale={locale} onOpen={() => setSelectedId(row.itemId)} />)}</div>
      : <p className="muted circle-empty">{uiText('Ничего не найдено')}</p>}
    <p className="muted circle-note">{uiText('Большинство обменов срабатывает один раз. Данные проверены 04.11.2026, после обновления игры они могут измениться.')}</p>
    {selected && <CircleDialog row={selected} items={items} mode={mode} needs={needs.get(selected.itemId) ?? []} locale={locale} onClose={() => setSelectedId(null)} />}
  </div>
}

function CircleTile({ row, item, needed, locale, onOpen }: { row: CircleRow; item: Item; needed: boolean; locale: Locale; onOpen: () => void }) {
  const [exchange] = row.exchanges
  return <button type="button" className="circle-tile" onClick={onOpen}>
    {needed && <span className="circle-tile-need">{uiText('нужно')}</span>}
    <span className="circle-picture"><StashPicture id={item.id} item={item} /></span>
    <strong>{uiText(item.name)}{row.count > 1 ? ` ×${row.count}` : ''}</strong>
    <small>{circleTime(exchange.seconds, locale)} · {uiText(exchange.repeatable ? 'можно повторять' : 'разово')}</small>
  </button>
}

function CircleDialog({ row, items, mode, needs, locale, onClose }: { row: CircleRow; items: Map<string, Item>; mode: RaidMode; needs: CircleNeed[]; locale: Locale; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const item = items.get(row.itemId)!
  // The same quest may ask for the item in several objectives: once in the list.
  const listed = [...new Map(needs.map((need) => [need.key, need])).values()]
  return createPortal(
    <div className="registration-overlay circle-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog circle-dialog" role="dialog" aria-modal="true" aria-labelledby="circle-dialog-title">
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <div className="circle-dialog-head">
          <span className="circle-picture"><StashPicture id={item.id} item={item} lazy={false} /></span>
          <h2 id="circle-dialog-title">{uiText(item.name)}{row.count > 1 ? ` ×${row.count}` : ''}</h2>
        </div>
        {row.exchanges.map((exchange, index) => <CircleExchangeBlock key={index} exchange={exchange} rewardId={row.itemId} items={items} mode={mode} locale={locale} />)}
        {listed.length > 0 && <div className="circle-block">
          <h3>{uiText('Нужно для')}</h3>
          <ul className="circle-needs">{listed.map((need) => <li key={need.key}>{uiText(need.label)}</li>)}</ul>
        </div>}
      </section>
    </div>,
    document.body,
  )
}

function CircleExchangeBlock({ exchange, rewardId, items, mode, locale }: { exchange: CircleExchange; rewardId: string; items: Map<string, Item>; mode: RaidMode; locale: Locale }) {
  const prices = exchange.put.map((stack) => fleaPrice(items.get(stack[0]), mode))
  const total = prices.every((price) => price !== undefined) ? exchange.put.reduce((sum, stack, index) => sum + prices[index]! * stackCount(stack), 0) : undefined
  const rewards = new Set(exchangeRewards(exchange).map(([id]) => id))
  // What else drops: the other rewards, and an item that comes back.
  const others = exchange.get.filter(([id]) => id !== rewardId && (rewards.has(id) || exchange.put.some(([spent]) => spent === id)))
  return <div className="circle-block">
    <h3>{uiText('Положить в круг')}</h3>
    <ul className="circle-put">{exchange.put.map((stack, index) => <CirclePutRow key={stack[0]} stack={stack} item={items.get(stack[0])!} price={prices[index]} />)}</ul>
    {exchange.put.length > 1 && total !== undefined && <p className="circle-total">{uiText('Всего на барахолке')}: <b>{formatPrice(total)}</b></p>}
    <p className="muted circle-only">{uiText('Только эти предметы: с другими результат будет случайным.')}</p>
    <dl className="circle-facts">
      <div><dt>{uiText('Время')}</dt><dd>{circleTime(exchange.seconds, locale)}</dd></div>
      <div><dt>{uiText('Сработает')}</dt><dd>{uiText(exchange.repeatable ? 'каждый раз' : 'один раз')}</dd></div>
      {others.length > 0 && <div><dt>{uiText('Вместе с ним выпадет')}</dt><dd>{others.map(([id, count = 1]) => `${uiText(items.get(id)!.name)}${count > 1 ? ` ×${count}` : ''}`).join(', ')}</dd></div>}
    </dl>
  </div>
}

function CirclePutRow({ stack, item, price }: { stack: CircleStack; item: Item; price?: number }) {
  const count = stackCount(stack)
  const copy = <>
    <span className="circle-picture"><StashPicture id={item.id} item={item} lazy={false} /></span>
    <span className="circle-put-copy">
      <strong>{uiText(item.name)}{count > 1 ? ` ×${count}` : ''}</strong>
      <small>{price === undefined ? uiText('на барахолке не продаётся') : `${formatPrice(price * count)} · ${uiText('барахолка')}`}</small>
    </span>
  </>
  // On the flea market it opens there, to buy it right away.
  return <li>{price === undefined ? <div className="circle-put-row">{copy}</div> : <Link className="circle-put-row is-link" to={`/flea?selected=${item.id}`}>{copy}</Link>}</li>
}
