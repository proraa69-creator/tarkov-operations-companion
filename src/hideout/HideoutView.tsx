import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Hammer, Lock, X } from 'lucide-react'
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
import { applyHideoutModules } from './hideoutModules'
import { useHideoutModules, useModeModules } from './hideoutModulesStore'
import { stationIcon } from './stationIcons'
import { basePicture, lightOf, lightStation, modulePiece, moduleSpot, pictureSize, roomsClosed, roomsInfo, roomsPicture } from './hideoutViews'
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
 * «Убежище» as in the game (owner, 20.11.2026): the hideout from above in one picture, always the same angle, built up from the
 * player's own levels — the base at level 0 under the light of the built Illumination, each built module's piece laid on it, the
 * rooms behind the defective wall black, their modules without buttons, until it is broken. A button on every module; the module's levels are set below the picture
 * («ставишь, что ты выставляешь уровень, и он тебе показывает всю информацию»): what the next level takes (have/need), its crafts and,
 * for every item, where it comes from (WhereToGet.tsx). The pictures come from the offline game copy (hideoutViews.ts); with none,
 * nothing is drawn. The owner's «Модули убежища» of the mode (hideoutModules.ts): a module turned off is not there at all; one open
 * from the start has its button and window even behind the wall not broken yet, without its piece of the picture until then (its
 * room is black, as the med station's before the breach).
 */
/** Really behind the defective wall: no button and a note until the breach (the rooms' other modules are built before it). */
const behindWall = (stationId: string) => Boolean((roomsInfo?.behind ?? roomsInfo?.inside)?.includes(stationId))

export function HideoutView() {
  return pictureSize && basePicture(lightOf(0)) ? <HideoutScene size={pictureSize} /> : null
}

/** The player's hideout from above: the base of their light, the pieces of their built levels, the closed rooms black. */
export function HideoutPicture({ stations, built }: { stations: readonly HideoutStation[]; built: Readonly<Record<string, number>> }) {
  const light = lightOf(lightStation ? built[lightStation] ?? 0 : 0)
  const base = basePicture(light)
  const closed = roomsClosed(built)
  return <>
    {base && <img className="hv-picture" src={base} alt="" draggable={false} />}
    {stations.map((station) => {
      const level = built[station.id] ?? 0
      // a module in a room still closed is not there yet
      const piece = level > 0 && !(closed && roomsInfo?.inside?.includes(station.id)) ? modulePiece(station.id, level, light) : undefined
      return piece && <img key={station.id} className="hv-piece" src={piece.url} alt="" draggable={false}
        style={{ left: `${piece.left * 100}%`, top: `${piece.top * 100}%`, width: `${piece.width * 100}%`, height: `${piece.height * 100}%` }} />
    })}
    {closed && roomsPicture() && <img className="hv-piece hv-rooms" src={roomsPicture()} alt="" draggable={false} />}
  </>
}

function HideoutScene({ size }: { size: { width: number; height: number } }) {
  const { data } = useTarkovData()
  const state = useAppState()
  const mode = state.raidMode
  const built = state.activeProfile.modes[mode].hideoutLevels
  const found = useHideoutFound(state.activeProfile.id, mode)
  const economy = useEconomySnapshot(mode)
  const [params, setParams] = useSearchParams()
  const openId = params.get('module')
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const modules = useHideoutModules()
  const openFromStart = useModeModules(mode).open
  const stations = useMemo(() => applyHideoutModules(withSeasonFoundInRaid(data.hideout.filter((station) => station.levels?.length), mode), mode, modules), [data.hideout, mode, modules])
  const station = stations.find((entry) => entry.id === openId)
  const closed = roomsClosed(built)
  // still behind the wall not broken yet: not open from the start in this mode
  const walledIn = (stationId: string) => closed && behindWall(stationId) && !openFromStart.has(stationId)
  // A phone shows the picture wider than the screen (the buttons would crowd), opened at its middle.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // after the first layout: the picture's width is known only then
    const frame = requestAnimationFrame(() => {
      const element = scroller.current
      if (element && element.scrollWidth > element.clientWidth) element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  const open = (id: string | null) => setParams((current) => {
    const next = new URLSearchParams(current)
    next.delete('craft')
    if (id) next.set('module', id); else next.delete('module')
    return next
  })
  return <section className="hv" aria-label={uiText('Убежище')}>
    <div className="hv-stage-scroll" ref={scroller}>
      <div className="hv-stage" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
        <HideoutPicture stations={stations} built={built} />
        {stations.map((entry) => {
          const spot = moduleSpot(entry.id)
          // a module behind the wall not broken yet is not shown at all (owner, 20.11.2026: «если стена не снесена, значит,
          // модули за этой стенкой не отображаются… Все, что до этого, показывается»)
          if (!spot || walledIn(entry.id)) return null
          const level = built[entry.id] ?? 0
          const max = entry.levels?.length ?? 0
          const ready = level < max && levelReady(entry.levels?.find((stage) => stage.level === level + 1), found)
          const icon = stationIcon(entry)
          return <button key={entry.id} type="button" className={`hv-spot${level >= max ? ' is-max' : ready ? ' is-ready' : level === 0 ? ' is-none' : ''}${entry.id === openId ? ' is-open' : ''}`}
            style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }} onClick={() => open(entry.id === openId ? null : entry.id)} aria-pressed={entry.id === openId}
            title={`${uiText(entry.name)} · ${level ? `${uiText('ур.')} ${roman(level)}` : uiText('не построен')}${ready ? `\n${uiText('Всё для улучшения собрано')}` : ''}`}
            aria-label={`${uiText(entry.name)}, ${level ? `${uiText('уровень')} ${level}` : uiText('не построен')}`}>
            {icon ? <img src={icon} alt="" /> : <span className="hv-spot-dot" />}
            {/* the level beside it, only once built (owner: «уровень, если он нужен, — маленькой подписью») */}
            {level > 0 && <span className="hv-spot-level">{String(level).padStart(2, '0')}</span>}
          </button>
        })}
      </div>
    </div>
    {station && <ModulePanel key={station.id} locked={walledIn(station.id)} station={station} stations={stations} built={built} found={found} items={items} economy={economy.data}
      craftId={params.get('craft')} onClose={() => open(null)} onLevel={(level) => state.setHideoutLevel(station.id, level)} />}
  </section>
}

interface ModulePanelProps {
  station: HideoutStation
  /** In a room behind the defective wall, still closed. */
  locked: boolean
  stations: readonly HideoutStation[]
  built: Record<string, number>
  found: ReadonlyMap<string, number>
  items: ReadonlyMap<string, Item>
  economy?: EconomySnapshot
  craftId: string | null
  onClose: () => void
  onLevel: (level: number) => void
}

/**
 * A module's window over the same picture (owner, 20.11.2026: «вид остаётся также сверху, просто открывается окно с этим модулем…
 * по этапам. Первый уровень, второй, третий. И для каждого уровня, что нужно»): the built level set by a press (the picture follows),
 * then every level in turn with what it takes, the built ones folded; its crafts below.
 */
function ModulePanel({ station, locked, stations, built, found, items, economy, craftId, onClose, onLevel }: ModulePanelProps) {
  const level = built[station.id] ?? 0
  const max = station.levels?.length ?? 0
  const stages = [...(station.levels ?? [])].sort((a, b) => a.level - b.level)
  const crafts = (economy?.crafts ?? []).filter((craft) => craft.stationId === station.id).sort((a, b) => a.level - b.level || a.duration - b.duration)
  return <aside className="panel hv-panel" aria-label={uiText(station.name)}>
    <button type="button" className="icon-button hv-panel-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={16} /></button>
    <header className="hv-panel-head">
      {stationIcon(station) && <img src={stationIcon(station)} alt="" />}
      <div>
        <h2>{uiText(station.name)}</h2>
        <span className="dim">{level ? `${uiText('Построен')}: ${uiText('ур.')} ${roman(level)} / ${roman(max)}` : uiText('Не построен')}</span>
      </div>
    </header>
    {locked && <p className="hv-locked-note"><Lock size={12} aria-hidden="true" /> {uiText('За аварийной стеной: откроется с её уровня')} {roman(roomsInfo!.openLevel)}</p>}
    <div className="hv-built" role="group" aria-label={uiText('Мой уровень')}>
      <span className="dim">{uiText('Мой уровень')}</span>
      {Array.from({ length: max + 1 }, (_, value) => <button key={value} type="button" aria-pressed={value === level}
        className={`${value === level ? 'is-current' : ''}${value <= level && value > 0 ? ' is-built' : ''}`} onClick={() => onLevel(value)}
        title={value === 0 ? uiText('Не построен') : `${uiText('Построен уровень')} ${roman(value)}`}>{value === 0 ? '·' : roman(value)}</button>)}
    </div>
    <div className="hv-stages">{stages.map((stage) => stage.level <= level
      ? <p key={stage.level} className="hv-stage-done"><Check size={13} aria-hidden="true" /> {uiText('Уровень')} {roman(stage.level)} · {uiText('построен')}</p>
      : <Requirements key={`${station.id}:${stage.level}`} stage={stage} stations={stations} built={built} found={found} items={items} economy={economy}
        next={stage.level === level + 1} onBuilt={() => onLevel(stage.level)} />)}</div>
    {level >= max && <p className="hv-max"><Check size={14} aria-hidden="true" /> {uiText('Максимальный уровень')}</p>}
    {crafts.length > 0 && <Crafts crafts={crafts} level={level} items={items} craftId={craftId} />}
  </aside>
}

interface RequirementsProps {
  stage: Stage
  stations: readonly HideoutStation[]
  built: Record<string, number>
  found: ReadonlyMap<string, number>
  items: ReadonlyMap<string, Item>
  economy?: EconomySnapshot
  /** The level to build next: it can be marked built. */
  next: boolean
  onBuilt: () => void
}

/**
 * What a level takes. An item to be found in raid (the tick) says at once where it can be made — the craft, the module and what goes
 * into it — and whether the cultist circle gives it (owner, 20.11.2026: «если есть предмет с галочкой, то указывать, можно ли его
 * скрафтить, где… и какие предметы нужны для крафта. И если он есть в круге сектантов… указывай на это тоже»); a barter does not give
 * it found in raid. Any other item shows where to get it on a press.
 */
function Requirements({ stage, stations, built, found, items, economy, next, onBuilt }: RequirementsProps) {
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
  return <div className={`hv-requirements${next ? ' is-next' : ''}`}>
    <h3>{uiText('Для уровня')} {roman(stage.level)}</h3>
    {goods.length > 0 && <ul className="hv-items">{goods.map((requirement) => {
      const have = Math.min(requirement.count, found.get(requirement.itemId) ?? 0)
      const item = items.get(requirement.itemId)
      const picked = itemId === requirement.itemId
      return <li key={requirement.itemId} className={`${have >= requirement.count ? 'is-have' : ''}${picked ? ' is-picked' : ''}`}>
        <button type="button" className="hv-item" aria-expanded={requirement.foundInRaid || picked} onClick={() => setItemId(picked ? null : requirement.itemId)} title={uiText('Где взять')}>
          <span className="hv-item-picture"><StashPicture id={requirement.itemId} item={item} /></span>
          <span className="hv-item-name">{uiText(item?.name ?? requirement.itemId)}{requirement.foundInRaid && <Check size={11} className="hv-fir" aria-label={uiText('найден в рейде')} />}</span>
          <strong className="hv-item-count">{have}/{requirement.count}</strong>
        </button>
        {requirement.foundInRaid
          ? <ItemSources itemId={requirement.itemId} economy={economy} items={items} stations={stations} built={built} foundInRaid />
          : picked && <ItemSources itemId={requirement.itemId} economy={economy} items={items} stations={stations} built={built} />}
      </li>
    })}</ul>}
    {money.length > 0 && <p className="hv-money">{money.map((requirement) => `${number(requirement.count)} ${MONEY[requirement.itemId]}`).join(' · ')}</p>}
    {others.length > 0 && <ul className="hv-others">{others.map((line) => <li key={line} className={moduleDone(line) ? 'is-have' : ''}>{moduleDone(line) ? <Check size={11} aria-hidden="true" /> : <Lock size={11} aria-hidden="true" />} {uiText(line)}</li>)}</ul>}
    {stage.constructionTimeHours ? <p className="dim hv-time">{uiText('Строится')}: {uiText(formatDuration(stage.constructionTimeHours * 3600))}</p> : null}
    {next && <button type="button" className={`button small ${ready ? 'primary' : 'ghost'} hv-mark`} onClick={onBuilt}><Check size={13} aria-hidden="true" /> {uiText('Построил')} {roman(stage.level)}</button>}
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
