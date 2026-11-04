import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import type { Item, RaidMode } from '../domain/types'
import { displayPrice } from '../domain/itemPrices'
import { formatPrice } from '../shared/format'
import { circleRows, circleTime, stackCount, type CircleExchange, type CircleRow, type CircleStack } from '../hideout/cultistCircle'
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

const NEEDED = 'Нужно для квестов и убежища'
const stackTitle = ([id, count = 1]: CircleStack, items: Map<string, Item>) => `${uiText(items.get(id)!.name)}${count > 1 ? ` ×${count}` : ''}`
/** Everything that drops, written together (owner, 05.11.2026: «Можешь это записывать вместе, все, что выпадет»). */
const dropsTitle = (row: CircleRow, items: Map<string, Item>) => row.drops.map((stack) => stackTitle(stack, items)).join(' + ')

const fleaPrice = (item: Item | undefined, mode: RaidMode) => {
  const price = displayPrice(item, mode)
  return price?.kind === 'flea' ? price.price : undefined
}

/**
 * «Круг сектантов» in «Убежище и квесты» (owner, 04.11.2026): what the circle surely gives, an exchange to a tile
 * (hideout/cultistCircle.ts). A click shows what to place for it, what it costs on this mode's flea market (owner: «ты
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
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
  const isNeeded = useCallback((row: CircleRow) => row.rewards.some(([id]) => needs.has(id)), [needs])
  const rows = useMemo(() => {
    const title = (row: CircleRow) => dropsTitle(row, items)
    return circleRows((id) => items.has(id)).sort((a, b) => Number(isNeeded(b)) - Number(isNeeded(a)) || title(a).localeCompare(title(b), locale))
  }, [items, isNeeded, locale])
  const needle = query.trim().toLowerCase()
  const visible = rows.filter((row) => {
    if (neededOnly && !isNeeded(row)) return false
    return !needle || row.drops.some(([id]) => {
      const item = items.get(id)!
      return [item.name, item.shortName, uiText(item.name), uiText(item.shortName)].some((text) => text.toLowerCase().includes(needle))
    })
  })
  const selected = rows.find((row) => row.key === selectedKey)

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
      <button type="button" className={`hs-chip${neededOnly ? ' is-active' : ''}`} aria-pressed={neededOnly} onClick={() => setNeededOnly((value) => !value)}><Check size={12} strokeWidth={3} aria-hidden="true" /> {uiText(NEEDED)}</button>
    </div>
    {visible.length > 0
      ? <div className="circle-grid">{visible.map((row) => <CircleTile key={row.key} row={row} items={items} needed={isNeeded(row)} locale={locale} onOpen={() => setSelectedKey(row.key)} />)}</div>
      : <p className="muted circle-empty">{uiText('Ничего не найдено')}</p>}
    <p className="muted circle-note">{uiText('Большинство обменов срабатывает один раз. Данные проверены 04.11.2026, после обновления игры они могут измениться.')}</p>
    {selected && <CircleDialog row={selected} items={items} mode={mode} needs={needs} locale={locale} onClose={() => setSelectedKey(null)} />}
  </div>
}

/** The pictures of everything that drops. */
function CirclePictures({ row, items, lazy }: { row: CircleRow; items: Map<string, Item>; lazy?: boolean }) {
  return <span className="circle-pictures" data-count={row.drops.length}>{row.drops.map(([id]) => <span key={id} className="circle-picture"><StashPicture id={id} item={items.get(id)} lazy={lazy} /></span>)}</span>
}

function CircleTile({ row, items, needed, locale, onOpen }: { row: CircleRow; items: Map<string, Item>; needed: boolean; locale: Locale; onOpen: () => void }) {
  const { exchange } = row
  return <button type="button" className="circle-tile" onClick={onOpen}>
    {/* The mark the stash gives an item needed from a raid (owner, 05.11.2026: «просто сделай галочку, и у нас кнопка будет обозначать, что нужно для квестов и убежища»). */}
    {needed && <span className="circle-tile-need" role="img" aria-label={uiText(NEEDED)} title={uiText(NEEDED)}><Check size={12} strokeWidth={3} aria-hidden="true" /></span>}
    <CirclePictures row={row} items={items} />
    <strong>{dropsTitle(row, items)}</strong>
    <small>{circleTime(exchange.seconds, locale)} · {uiText(exchange.repeatable ? 'можно повторять' : 'разово')}</small>
  </button>
}

function CircleDialog({ row, items, mode, needs, locale, onClose }: { row: CircleRow; items: Map<string, Item>; mode: RaidMode; needs: Map<string, CircleNeed[]>; locale: Locale; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // The same quest may ask for an item in several objectives: once in the list. With several rewards, which one it wants.
  const listed = [...new Map(row.rewards.flatMap(([id]) => (needs.get(id) ?? []).map((need) => [`${id}:${need.key}`, {
    key: `${id}:${need.key}`,
    label: row.rewards.length > 1 ? `${uiText(need.label)} — ${uiText(items.get(id)!.name)}` : uiText(need.label),
  }] as const))).values()]
  return createPortal(
    <div className="registration-overlay circle-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog circle-dialog" role="dialog" aria-modal="true" aria-labelledby="circle-dialog-title">
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <div className="circle-dialog-head">
          <CirclePictures row={row} items={items} lazy={false} />
          <h2 id="circle-dialog-title">{dropsTitle(row, items)}</h2>
        </div>
        <CircleExchangeBlock exchange={row.exchange} items={items} mode={mode} locale={locale} />
        {listed.length > 0 && <div className="circle-block">
          <h3>{uiText('Нужно для')}</h3>
          <ul className="circle-needs">{listed.map((need) => <li key={need.key}>{need.label}</li>)}</ul>
        </div>}
      </section>
    </div>,
    document.body,
  )
}

function CircleExchangeBlock({ exchange, items, mode, locale }: { exchange: CircleExchange; items: Map<string, Item>; mode: RaidMode; locale: Locale }) {
  const prices = exchange.put.map((stack) => fleaPrice(items.get(stack[0]), mode))
  const total = prices.every((price) => price !== undefined) ? exchange.put.reduce((sum, stack, index) => sum + prices[index]! * stackCount(stack), 0) : undefined
  return <div className="circle-block">
    <h3>{uiText('Положить в круг')}</h3>
    <ul className="circle-put">{exchange.put.map((stack, index) => <CirclePutRow key={stack[0]} stack={stack} item={items.get(stack[0])!} price={prices[index]} />)}</ul>
    {exchange.put.length > 1 && total !== undefined && <p className="circle-total">{uiText('Всего на барахолке')}: <b>{formatPrice(total)}</b></p>}
    <p className="muted circle-only">{uiText('Только эти предметы: с другими результат будет случайным.')}</p>
    <dl className="circle-facts">
      <div><dt>{uiText('Время')}</dt><dd>{circleTime(exchange.seconds, locale)}</dd></div>
      <div><dt>{uiText('Сработает')}</dt><dd>{uiText(exchange.repeatable ? 'каждый раз' : 'один раз')}</dd></div>
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
