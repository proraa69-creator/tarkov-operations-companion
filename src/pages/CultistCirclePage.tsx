import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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
interface CircleNeed { key: string; label: string; questId?: string }

const NEEDED = 'Нужно для квестов и убежища'
const MAYBE = 'возможно, выпадет'
const stackTitle = ([id, count = 1]: CircleStack, items: Map<string, Item>) => `${uiText(items.get(id)!.name)}${count > 1 ? ` ×${count}` : ''}`
/** Everything that drops, for sorting, the tooltip and a screen reader. */
const dropsTitle = (row: CircleRow, items: Map<string, Item>) => row.drops.map((stack) => stackTitle(stack, items)).join(' + ')

const fleaPrice = (item: Item | undefined, mode: RaidMode) => {
  const price = displayPrice(item, mode)
  return price?.kind === 'flea' ? price.price : undefined
}

/**
 * One clock for the tiles that change their picture (owner, 05.11.2026: «Каждые 2 секунды сделай, чтобы они менялись»), so
 * they change together and a tile with one item never renders for it. It stands while no such tile is on the page or the
 * window is not seen.
 */
const CHANGE_MS = 2_000
let changes = 0
let clock: ReturnType<typeof setInterval> | undefined
const watching = new Set<() => void>()
function subscribeChanges(listener: () => void) {
  watching.add(listener)
  clock ??= setInterval(() => {
    if (document.hidden) return
    changes += 1
    for (const notify of watching) notify()
  }, CHANGE_MS)
  return () => {
    watching.delete(listener)
    if (!watching.size && clock !== undefined) {
      clearInterval(clock)
      clock = undefined
    }
  }
}
const subscribeNever = () => () => {}
const readChanges = () => changes
const readNone = () => 0

/**
 * «Круг сектантов» in «Убежище и квесты» (owner, 04.11.2026): what the circle gives, an exchange to a tile
 * (hideout/cultistCircle.ts). A click shows what drops, what to place for it, what that costs on this mode's flea market (owner:
 * «ты знаешь что это можно купить на барахолке и загнать на круг») and which current or available quests, which lead to
 * themselves, and which hideout levels of this mode still want it.
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
        if (!use.done && (status === 'active' || status === 'available')) add(need.itemId, { key: `quest:${use.stationId}`, label: use.stationName, questId: use.stationId })
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
        <p className="page-subtitle">{uiText('Что выпадает из круга. Нажмите на предмет, чтобы увидеть, что положить в круг.')}</p>
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

/**
 * A tile shows one item that drops, picture and name; with several they take turns every two seconds (owner, 05.11.2026:
 * «бутылка виски, потом ключ с подписью, и сигнальный пистолет»). They lie on one another, so the tile keeps its size and each
 * picture is loaded before its turn.
 */
function CircleTile({ row, items, needed, locale, onOpen }: { row: CircleRow; items: Map<string, Item>; needed: boolean; locale: Locale; onOpen: () => void }) {
  const { exchange, drops, maybe } = row
  const several = drops.length > 1
  const shown = useSyncExternalStore(several ? subscribeChanges : subscribeNever, several ? readChanges : readNone) % drops.length
  const rule = `${circleTime(exchange.seconds, locale)} · ${uiText(exchange.repeatable ? 'можно повторять' : 'разово')}`
  // A screen reader hears all of them at once, not the one whose turn it is.
  const spoken = several ? `${needed ? `${uiText(NEEDED)}. ` : ''}${drops.map((stack) => `${stackTitle(stack, items)}${maybe.has(stack[0]) ? ` (${uiText(MAYBE)})` : ''}`).join(', ')}. ${rule}` : undefined
  return <button type="button" className="circle-tile" title={dropsTitle(row, items)} aria-label={spoken} onClick={onOpen}>
    {/* The mark the stash gives an item needed from a raid (owner, 05.11.2026: «просто сделай галочку, и у нас кнопка будет обозначать, что нужно для квестов и убежища»). */}
    {needed && <span className="circle-tile-need" role="img" aria-label={uiText(NEEDED)} title={uiText(NEEDED)}><Check size={12} strokeWidth={3} aria-hidden="true" /></span>}
    <span className="circle-turns">{drops.map(([id], index) => <span key={id} className="circle-picture" data-shown={index === shown}><StashPicture id={id} item={items.get(id)} /></span>)}</span>
    <span className="circle-turns">{drops.map((stack, index) => <span key={stack[0]} className="circle-tile-name" data-shown={index === shown}>
      <strong>{stackTitle(stack, items)}</strong>
      {maybe.has(stack[0]) && <small className="circle-maybe">{uiText(MAYBE)}</small>}
    </span>)}</span>
    <small>{rule}</small>
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
    ...need,
    key: `${id}:${need.key}`,
    wants: row.rewards.length > 1 ? uiText(items.get(id)!.name) : undefined,
  }] as const))).values()]
  const [only] = row.drops
  return createPortal(
    <div className="registration-overlay circle-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog circle-dialog" role="dialog" aria-modal="true" aria-label={dropsTitle(row, items)}>
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        {row.drops.length > 1
          // Owner, 05.11.2026: «А когда открываешь, сверху список. То, что выпадает».
          ? <div className="circle-block circle-drops">
            <h3>{uiText('Выпадет')}</h3>
            <ul className="circle-put">{row.drops.map((stack) => <li key={stack[0]}><div className="circle-put-row">
              <span className="circle-picture"><StashPicture id={stack[0]} item={items.get(stack[0])} lazy={false} /></span>
              <span className="circle-put-copy">
                <strong>{stackTitle(stack, items)}</strong>
                {row.maybe.has(stack[0]) && <small className="circle-maybe">{uiText(MAYBE)}</small>}
              </span>
            </div></li>)}</ul>
            {row.exchange.picks !== undefined && <p className="circle-total">{uiText('Всего выпадет')}: <b>{row.exchange.picks}</b></p>}
          </div>
          : <div className="circle-dialog-head">
            <span className="circle-picture"><StashPicture id={only[0]} item={items.get(only[0])} lazy={false} /></span>
            <h2>{stackTitle(only, items)}</h2>
          </div>}
        <CircleExchangeBlock exchange={row.exchange} items={items} mode={mode} locale={locale} />
        {listed.length > 0 && <div className="circle-block">
          <h3>{uiText('Нужно для')}</h3>
          <ul className="circle-needs">{listed.map((need) => <li key={need.key}>
            {/* Owner, 05.11.2026: «сделай, чтобы на этот квест можно было нажать и перейти к нему». */}
            {need.questId ? <Link to={`/quests?selected=${encodeURIComponent(need.questId)}&filter=all`}>{uiText(need.label)}</Link> : uiText(need.label)}
            {need.wants && ` — ${need.wants}`}
          </li>)}</ul>
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
