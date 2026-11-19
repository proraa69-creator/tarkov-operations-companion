import { useMemo, useState } from 'react'
import { ChevronDown, Hammer, Lock, Repeat, Skull } from 'lucide-react'
import { Link } from 'react-router-dom'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { formatDuration } from '../domain/economy'
import type { HideoutStation, Item } from '../domain/types'
import type { EconomySnapshot, ItemCount } from '../data/economyApi'
import { StashPicture } from '../pages/HideoutStashPage'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { useEconomySnapshot } from '../data/useEconomy'
import { circleTime, stackCount } from './cultistCircle'
import { itemSources, sourceOpen, type ItemSource } from './itemSources'
import '../styles/hideoutView.css'

const CIRCLE = 'cultist-circle'
const roman = (level: number) => ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'][level] ?? String(level)

interface ItemSourcesProps {
  itemId: string
  economy?: Pick<EconomySnapshot, 'crafts' | 'barters'>
  items: ReadonlyMap<string, Item>
  stations: readonly HideoutStation[]
  built: Readonly<Record<string, number>>
}

/**
 * «Где взять» (owner, 20.11.2026: «появляется окно, и там будет писаться, можно скрафтить на верстаке или можно скрафтить в санузле.
 * Либо… можно добыть в круге сектантов… каждая строка нажимается»): one row per craft, barter and circle exchange that gives the
 * item; a row opens what it takes, and from there the module or the circle.
 */
export function ItemSources({ itemId, economy, items, stations, built }: ItemSourcesProps) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const circleId = stations.find((station) => station.normalizedName === CIRCLE)?.id
  const sources = itemSources(itemId, economy)
  if (!economy && !sources.length) return null
  return <div className="hv-sources">
    <h4>{uiText('Где взять')}</h4>
    {sources.length ? <ul>
      {sources.map((source) => {
        const open = sourceOpen(source, built, circleId)
        const expanded = openKey === source.key
        return <li key={source.key} className={`${open ? '' : 'is-locked'}${expanded ? ' is-open' : ''}`}>
          <button type="button" className="hv-source-row" aria-expanded={expanded} onClick={() => setOpenKey(expanded ? null : source.key)}>
            <SourceIcon source={source} />
            <span className="hv-source-text">{sourceTitle(source, stations)}</span>
            {!open && <Lock size={11} aria-label={uiText('Не построено')} />}
            <ChevronDown size={13} className="hv-source-chevron" aria-hidden="true" />
          </button>
          {expanded && <SourceDetail source={source} items={items} />}
        </li>
      })}
    </ul> : <p className="dim hv-sources-none">{uiText('Не крафтится и не меняется — только найти или купить.')}</p>}
  </div>
}

/** The same list for an item card of «Что собрать» (hideout and quests), with the mode's own data. */
export function ItemSourcesBlock({ itemId }: { itemId: string }) {
  const { data } = useTarkovData()
  const state = useAppState()
  const mode = state.raidMode
  const economy = useEconomySnapshot(mode)
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  return <ItemSources itemId={itemId} economy={economy.data} items={items} stations={data.hideout} built={state.activeProfile.modes[mode].hideoutLevels} />
}

function SourceIcon({ source }: { source: ItemSource }) {
  if (source.kind === 'craft') return <Hammer size={13} aria-hidden="true" />
  if (source.kind === 'barter') return <Repeat size={13} aria-hidden="true" />
  return <Skull size={13} aria-hidden="true" />
}

/** «Скрафтить: Верстак, ур. II» / «Обменять: Механик, ур. 3» / «Круг сектантов». */
function sourceTitle(source: ItemSource, stations: readonly HideoutStation[]): string {
  const count = source.count > 1 ? ` ×${source.count}` : ''
  if (source.kind === 'craft') {
    const name = stations.find((station) => station.id === source.craft.stationId)?.name ?? source.craft.stationName
    return `${uiText('Скрафтить')}: ${uiText(name)}, ${uiText('ур.')} ${roman(source.craft.level)}${count}`
  }
  if (source.kind === 'barter') return `${uiText('Обменять')}: ${uiText(source.barter.traderName)}, ${uiText('ур.')} ${source.barter.level}${count}`
  return `${uiText('Круг сектантов')}${count}${source.maybe ? ` · ${uiText('возможно')}` : ''}`
}

function Lines({ lines, items }: { lines: readonly ItemCount[]; items: ReadonlyMap<string, Item> }) {
  return <ul className="hv-source-lines">{lines.map((line) => <li key={line.itemId}>
    <span className="hv-source-picture"><StashPicture id={line.itemId} item={items.get(line.itemId)} /></span>
    <span>{uiText(items.get(line.itemId)?.name ?? line.itemId)}</span>
    <strong>×{line.count}</strong>
  </li>)}</ul>
}

function SourceDetail({ source, items }: { source: ItemSource; items: ReadonlyMap<string, Item> }) {
  const { locale } = useLocale()
  if (source.kind === 'craft') {
    const { craft } = source
    return <div className="hv-source-detail">
      <Lines lines={craft.requiredItems} items={items} />
      <p className="dim">{uiText(formatDuration(craft.duration))}{craft.taskUnlock ? ` · ${uiText('после квеста')} ${uiText(craft.taskUnlock.name)}` : ''}</p>
      <Link className="button small ghost" to={`/hideout?module=${encodeURIComponent(craft.stationId)}&craft=${encodeURIComponent(craft.id)}`}>{uiText('Открыть модуль')}</Link>
    </div>
  }
  if (source.kind === 'barter') {
    const { barter } = source
    return <div className="hv-source-detail">
      <Lines lines={barter.requiredItems} items={items} />
      <p className="dim">{uiText(barter.traderName)}, {uiText('ур.')} {barter.level}{barter.taskUnlock ? ` · ${uiText('после квеста')} ${uiText(barter.taskUnlock.name)}` : ''}{barter.buyLimit ? ` · ${uiText('лимит')} ${barter.buyLimit}` : ''}</p>
    </div>
  }
  const { exchange } = source.row
  return <div className="hv-source-detail">
    <Lines lines={exchange.put.map((stack) => ({ itemId: stack[0], count: stackCount(stack) }))} items={items} />
    <p className="dim">{exchange.seconds === undefined ? uiText('время неизвестно') : circleTime(exchange.seconds, locale)} · {uiText(exchange.repeatable ? 'каждый раз' : 'один раз')}</p>
    <Link className="button small ghost" to={`/hideout/cultist-circle?open=${encodeURIComponent(source.row.key)}`}>{uiText('Открыть круг')}</Link>
  </div>
}
