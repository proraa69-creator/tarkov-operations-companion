import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Hammer, Lock, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { useEconomySnapshot } from '../data/useEconomy'
import { formatDuration } from '../domain/economy'
import type { HideoutStation, Item } from '../domain/types'
import type { Craft, EconomySnapshot } from '../data/economyApi'
import { StashPicture } from '../pages/HideoutStashPage'
import { useHideoutFound } from './hideoutFound'
import { DOLLARS, EUROS, ROUBLES } from './hideoutNeeds'
import { withSeasonFoundInRaid } from './seasonFoundInRaid'
import { stationIcon } from './stationIcons'
import { modulePicture, moduleSpot, overviewPicture, overviewSize } from './hideoutViews'
import { ItemSources } from './WhereToGet'
import '../styles/hideoutView.css'

const roman = (level: number) => ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'][level] ?? String(level)
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value)
const MONEY: Record<string, string> = { [ROUBLES]: '₽', [DOLLARS]: '$', [EUROS]: '€' }

type Stage = NonNullable<HideoutStation['levels']>[number]

/** The pieces found for the hideout cover this level's items (money aside: it is bought, not found). */
function levelReady(stage: Stage | undefined, found: ReadonlyMap<string, number>) {
  return Boolean(stage) && (stage!.itemRequirements ?? []).every((requirement) => MONEY[requirement.itemId] || (found.get(requirement.itemId) ?? 0) >= requirement.count)
}

/**
 * «Убежище» as in the game (owner, 20.11.2026): the whole hideout in one picture with a button on every module — no walking about;
 * a module opens its own picture at its level, what the next level takes (what the player has of it, as the game counts: found for
 * the hideout against the count) and its crafts. Every item of a level says where it comes from (WhereToGet.tsx). The pictures come from
 * the offline game copy (hideoutViews.ts); with none, nothing is drawn.
 */
export function HideoutView() {
  const overview = overviewPicture()
  return overview && overviewSize ? <HideoutScene overview={overview} size={overviewSize} /> : null
}

function HideoutScene({ overview, size }: { overview: string; size: { width: number; height: number } }) {
  const { data } = useTarkovData()
  const state = useAppState()
  const mode = state.raidMode
  const built = state.activeProfile.modes[mode].hideoutLevels
  const found = useHideoutFound(state.activeProfile.id, mode)
  const economy = useEconomySnapshot(mode)
  const [params, setParams] = useSearchParams()
  const openId = params.get('module')
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const stations = useMemo(() => withSeasonFoundInRaid(data.hideout.filter((station) => station.levels?.length), mode), [data.hideout, mode])
  const station = stations.find((entry) => entry.id === openId)
  // A phone shows the picture wider than the screen (the buttons would crowd), opened at its middle.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = scroller.current
    if (element && element.scrollWidth > element.clientWidth) element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2
  }, [station])
  const open = (id: string | null) => setParams((current) => {
    const next = new URLSearchParams(current)
    next.delete('craft')
    if (id) next.set('module', id); else next.delete('module')
    return next
  })
  return <section className="hv" aria-label={uiText('Убежище')}>
    {station
      ? <ModuleView key={`${station.id}:${built[station.id] ?? 0}`} station={station} stations={stations} built={built} found={found} items={items} economy={economy.data} craftId={params.get('craft')}
        onBack={() => open(null)} onLevel={(level) => state.setHideoutLevel(station.id, level)} />
      : <div className="hv-stage-scroll" ref={scroller}><div className="hv-stage" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
        <img className="hv-picture" src={overview} alt={uiText('Убежище')} />
        {stations.map((entry) => {
          const spot = moduleSpot(entry.id)
          if (!spot) return null
          const level = built[entry.id] ?? 0
          const max = entry.levels?.length ?? 0
          const ready = level < max && levelReady(entry.levels?.find((stage) => stage.level === level + 1), found)
          const icon = stationIcon(entry)
          return <button key={entry.id} type="button" className={`hv-spot${level >= max ? ' is-max' : ready ? ' is-ready' : level === 0 ? ' is-none' : ''}`}
            style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }} onClick={() => open(entry.id)}
            title={`${uiText(entry.name)} · ${level ? `${uiText('ур.')} ${roman(level)}` : uiText('не построен')}${ready ? `\n${uiText('Всё для улучшения собрано')}` : ''}`}
            aria-label={`${uiText(entry.name)}, ${level ? `${uiText('уровень')} ${level}` : uiText('не построен')}`}>
            {icon ? <img src={icon} alt="" /> : <span className="hv-spot-dot" />}
            <span className="hv-spot-level">{level ? roman(level) : '·'}</span>
          </button>
        })}
      </div></div>}
  </section>
}

interface ModuleViewProps {
  station: HideoutStation
  stations: readonly HideoutStation[]
  built: Record<string, number>
  found: ReadonlyMap<string, number>
  items: ReadonlyMap<string, Item>
  economy?: EconomySnapshot
  craftId: string | null
  onBack: () => void
  onLevel: (level: number) => void
}

function ModuleView({ station, stations, built, found, items, economy, craftId, onBack, onLevel }: ModuleViewProps) {
  const level = built[station.id] ?? 0
  const max = station.levels?.length ?? 0
  // The picture of the level looked at: the built one, or one picked above it to see what comes.
  // (the view is keyed by module and built level: a change starts it again at the built level)
  const [shown, setShown] = useState(level)
  const next = Math.min(max, shown > level ? shown : level + 1)
  const stage = level >= max && shown <= level ? undefined : station.levels?.find((entry) => entry.level === next)
  const crafts = (economy?.crafts ?? []).filter((craft) => craft.stationId === station.id).sort((a, b) => a.level - b.level || a.duration - b.duration)
  const picture = modulePicture(station.id, shown)
  return <div className="hv-module">
    <div className="hv-module-stage" style={overviewSize ? { aspectRatio: `${overviewSize.width} / ${overviewSize.height}` } : undefined}>
      {picture ? <img className="hv-picture" src={picture} alt={`${uiText(station.name)} · ${roman(shown)}`} /> : <div className="hv-picture is-empty">{uiText('Снимка пока нет')}</div>}
      <button type="button" className="hv-back" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /> {uiText('Убежище')}</button>
      <div className="hv-levels" role="group" aria-label={uiText('Уровень на снимке')}>
        {Array.from({ length: max + 1 }, (_, value) => <button key={value} type="button" aria-pressed={value === shown}
          className={`${value === shown ? 'is-shown' : ''}${value <= level && value > 0 ? ' is-built' : ''}`} onClick={() => setShown(value)}
          title={value === 0 ? uiText('Не построен') : `${uiText('Уровень')} ${roman(value)}`}>{value === 0 ? '·' : roman(value)}</button>)}
      </div>
    </div>
    <aside className="panel hv-panel">
      <button type="button" className="icon-button hv-panel-close" onClick={onBack} aria-label={uiText('Закрыть')}><X size={16} /></button>
      <header className="hv-panel-head">
        {stationIcon(station) && <img src={stationIcon(station)} alt="" />}
        <div>
          <h2>{uiText(station.name)}</h2>
          <span className="dim">{level ? `${uiText('Построен')}: ${uiText('ур.')} ${roman(level)} / ${roman(max)}` : uiText('Не построен')}</span>
        </div>
      </header>
      {stage
        ? <Requirements key={`${station.id}:${stage.level}`} stage={stage} stations={stations} built={built} found={found} items={items} economy={economy}
          onBuilt={() => onLevel(stage.level)} canMark={stage.level === level + 1} />
        : <p className="hv-max"><Check size={14} aria-hidden="true" /> {uiText('Максимальный уровень')}</p>}
      {level > 0 && (!stage || stage.level === level + 1) && <button type="button" className="button small ghost hv-undo" onClick={() => onLevel(level - 1)}>{uiText('Снять уровень')} {roman(level)}</button>}
      {crafts.length > 0 && <Crafts crafts={crafts} level={level} items={items} craftId={craftId} />}
    </aside>
  </div>
}

interface RequirementsProps {
  stage: Stage
  stations: readonly HideoutStation[]
  built: Record<string, number>
  found: ReadonlyMap<string, number>
  items: ReadonlyMap<string, Item>
  economy?: EconomySnapshot
  canMark: boolean
  onBuilt: () => void
}

function Requirements({ stage, stations, built, found, items, economy, canMark, onBuilt }: RequirementsProps) {
  // (keyed by module and level: another level starts with no item open)
  const [itemId, setItemId] = useState<string | null>(null)
  const goods = (stage.itemRequirements ?? []).filter((requirement) => !MONEY[requirement.itemId])
  const money = (stage.itemRequirements ?? []).filter((requirement) => MONEY[requirement.itemId])
  // Modules, traders and skills (catalogSource adaptHideout: the item lines come first in `requirements`).
  const others = [...(stage.stationRequirements ?? []), ...stage.requirements.slice(stage.itemRequirements?.length ?? 0)]
  // «Медблок ур. 2»: done when that module is built so far
  const moduleDone = (line: string) => stations.some((entry) => {
    const prefix = `${entry.name} ур. `
    const need = line.startsWith(prefix) ? Number(line.slice(prefix.length)) : NaN
    return Number.isFinite(need) && (built[entry.id] ?? 0) >= need
  })
  const ready = levelReady(stage, found)
  return <div className="hv-requirements">
    <h3>{uiText('Для уровня')} {roman(stage.level)}</h3>
    {goods.length > 0 && <ul className="hv-items">{goods.map((requirement) => {
      const have = Math.min(requirement.count, found.get(requirement.itemId) ?? 0)
      const item = items.get(requirement.itemId)
      const picked = itemId === requirement.itemId
      return <li key={requirement.itemId} className={`${have >= requirement.count ? 'is-have' : ''}${picked ? ' is-picked' : ''}`}>
        <button type="button" className="hv-item" aria-expanded={picked} onClick={() => setItemId(picked ? null : requirement.itemId)} title={uiText('Где взять')}>
          <span className="hv-item-picture"><StashPicture id={requirement.itemId} item={item} /></span>
          <span className="hv-item-name">{uiText(item?.name ?? requirement.itemId)}{requirement.foundInRaid && <Check size={11} className="hv-fir" aria-label={uiText('найден в рейде')} />}</span>
          <strong className="hv-item-count">{have}/{requirement.count}</strong>
        </button>
        {picked && <ItemSources itemId={requirement.itemId} economy={economy} items={items} stations={stations} built={built} />}
      </li>
    })}</ul>}
    {money.length > 0 && <p className="hv-money">{money.map((requirement) => `${number(requirement.count)} ${MONEY[requirement.itemId]}`).join(' · ')}</p>}
    {others.length > 0 && <ul className="hv-others">{others.map((line) => <li key={line} className={moduleDone(line) ? 'is-have' : ''}>{moduleDone(line) ? <Check size={11} aria-hidden="true" /> : <Lock size={11} aria-hidden="true" />} {uiText(line)}</li>)}</ul>}
    {stage.constructionTimeHours ? <p className="dim hv-time">{uiText('Строится')}: {uiText(formatDuration(stage.constructionTimeHours * 3600))}</p> : null}
    {canMark && <button type="button" className={`button small ${ready ? 'primary' : 'ghost'} hv-mark`} onClick={onBuilt}><Check size={13} aria-hidden="true" /> {uiText('Построил')} {roman(stage.level)}</button>}
  </div>
}

function Crafts({ crafts, level, items, craftId }: { crafts: readonly Craft[]; level: number; items: ReadonlyMap<string, Item>; craftId: string | null }) {
  useEffect(() => {
    if (craftId) document.getElementById(`hv-craft-${craftId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [craftId])
  return <div className="hv-crafts">
    <h3><Hammer size={13} aria-hidden="true" /> {uiText('Крафты')}</h3>
    <ul>{crafts.map((craft) => <li key={craft.id} id={`hv-craft-${craft.id}`} className={`${craft.level > level ? 'is-locked' : ''}${craft.id === craftId ? ' is-target' : ''}`}>
      <span className="hv-craft-level">{roman(craft.level)}</span>
      <span className="hv-craft-lines">{craft.requiredItems.map((line) => <span key={line.itemId} className="hv-craft-item" title={uiText(items.get(line.itemId)?.name ?? '')}><StashPicture id={line.itemId} item={items.get(line.itemId)} />{line.count > 1 && <small>×{line.count}</small>}</span>)}</span>
      <span className="hv-craft-arrow" aria-hidden="true">→</span>
      <span className="hv-craft-lines">{craft.rewardItems.map((line) => <span key={line.itemId} className="hv-craft-item" title={uiText(items.get(line.itemId)?.name ?? '')}><StashPicture id={line.itemId} item={items.get(line.itemId)} />{line.count > 1 && <small>×{line.count}</small>}</span>)}</span>
      <span className="hv-craft-time dim">{uiText(formatDuration(craft.duration))}</span>
    </li>)}</ul>
  </div>
}
