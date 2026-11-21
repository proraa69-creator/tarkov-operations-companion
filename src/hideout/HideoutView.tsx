import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Hammer, Lock, TreePine, X } from 'lucide-react'
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
import { basePicture, christmasPiece, christmasSeason, lightOf, lightStation, modulePiece, moduleSpot, nearestLight, pictureSize, roomsClosed, roomsInfo, roomsPicture } from './hideoutViews'
import { ItemSources } from './WhereToGet'
import '../styles/hideoutView.css'

const CHRISTMAS_KEY = 'raidos-hideout-christmas'
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
 * rooms behind the defective wall black, its modules without buttons, until it is broken. A button on every module; its window opens beside the picture, a level at a
 * time («нажимаешь один уровень, появляется один, что требуется»): what that level takes (have/need), its crafts and,
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

/**
 * The player's hideout from above: the base of their light, the pieces of their built levels, the closed rooms black. `preview`:
 * the module whose level is looked at in its window; when the player's light has no piece of that level (the dark hides it), a soft
 * spot round the module shows the hideout under the nearest light that has one. `light` forces the light (that spot).
 */
export function HideoutPicture({ stations, built, christmas = false, preview, light: forced }: {
  stations: readonly HideoutStation[]; built: Readonly<Record<string, number>>; christmas?: boolean; preview?: string; light?: number
}) {
  const light = forced ?? lightOf(lightStation ? built[lightStation] ?? 0 : 0)
  const base = basePicture(light)
  const closed = roomsClosed(built)
  const shown = (stationId: string) => (built[stationId] ?? 0) > 0 && !(closed && roomsInfo?.inside?.includes(stationId))
  const previewLevel = preview ? built[preview] ?? 0 : 0
  const lit = forced === undefined && preview && shown(preview) && !modulePiece(preview, previewLevel, light) ? nearestLight(preview, previewLevel, light) : undefined
  const litPiece = preview && lit !== undefined ? modulePiece(preview, previewLevel, lit) : undefined
  return <>
    {base && <img className="hv-picture" src={base} alt="" draggable={false} />}
    {/* the wall's piece first: it brings the rooms behind it at level 0, and their modules' pieces (shot on the broken wall) lie on it */}
    {[...stations].sort((a, b) => Number(b.id === roomsInfo?.station) - Number(a.id === roomsInfo?.station)).map((station) => {
      // a module in a room still closed is not there yet
      const piece = shown(station.id) ? modulePiece(station.id, built[station.id] ?? 0, light) : undefined
      return piece && <img key={station.id} className="hv-piece" src={piece.url} alt="" draggable={false}
        style={{ left: `${piece.left * 100}%`, top: `${piece.top * 100}%`, width: `${piece.width * 100}%`, height: `${piece.height * 100}%` }} />
    })}
    {closed && roomsPicture() && <img className="hv-piece hv-rooms" src={roomsPicture()} alt="" draggable={false} />}
    {litPiece && (() => {
      const mask = `radial-gradient(${litPiece.width * 80}% ${litPiece.height * 80}% at ${(litPiece.left + litPiece.width / 2) * 100}% ${(litPiece.top + litPiece.height / 2) * 100}%, #000 60%, transparent)`
      return <div className="hv-lit" style={{ maskImage: mask, WebkitMaskImage: mask }}>
        <HideoutPicture stations={stations} built={built} light={lit} />
      </div>
    })()}
    {christmas && (() => {
      const tree = christmasPiece(light)
      return tree && <img className="hv-piece" src={tree.url} alt="" draggable={false}
        style={{ left: `${tree.left * 100}%`, top: `${tree.top * 100}%`, width: `${tree.width * 100}%`, height: `${tree.height * 100}%` }} />
    })()}
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
  const craftId = params.get('craft')
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const modules = useHideoutModules()
  const openFromStart = useModeModules(mode).open
  const stations = useMemo(() => applyHideoutModules(withSeasonFoundInRaid(data.hideout.filter((station) => station.levels?.length), mode), mode, modules), [data.hideout, mode, modules])
  const station = stations.find((entry) => entry.id === openId)
  const closed = roomsClosed(built)
  // The Christmas tree and garlands (owner, 20.11.2026: «сделай елку и гирлянду как там»): on by itself in the game's season,
  // a press turns it on or off (kept on this device).
  const hasTree = [0, 1, 2, 3].some((light) => christmasPiece(light))
  const [christmas, setChristmas] = useState(() => {
    try { const kept = localStorage.getItem(CHRISTMAS_KEY); if (kept === 'on' || kept === 'off') return kept === 'on' } catch { /* storage unavailable */ }
    return christmasSeason()
  })
  const toggleChristmas = () => setChristmas((value) => {
    try { localStorage.setItem(CHRISTMAS_KEY, value ? 'off' : 'on') } catch { /* storage unavailable */ }
    return !value
  })
  // The level looked at in the module's window (owner, 20.11.2026: «нажимаешь один уровень, появляется один, что требуется… При нажатии
  // на уровень модуля в самом убежище меняется модуль визуально»): the next one to build, or a craft's level when a craft was asked for.
  const [picked, setPicked] = useState<{ id: string; level: number } | null>(null)
  const builtLevel = station ? built[station.id] ?? 0 : 0
  const maxLevel = station?.levels?.length ?? 0
  const craftLevel = craftId && station ? economy.data?.crafts.find((craft) => craft.id === craftId && craft.stationId === station.id)?.level : undefined
  const shownLevel = !station ? 0 : picked?.id === station.id ? picked.level : craftLevel ?? Math.min(maxLevel, Math.max(1, builtLevel + 1))
  // The picture shows that module at the level looked at; one in a room behind the standing wall is shown with the wall broken.
  const view = useMemo(() => {
    if (!station || shownLevel === builtLevel) return built
    const next: Record<string, number> = { ...built, [station.id]: shownLevel }
    if (roomsInfo?.station && roomsInfo.inside?.includes(station.id) && (built[roomsInfo.station] ?? 0) < roomsInfo.openLevel) next[roomsInfo.station] = roomsInfo.openLevel
    return next
  }, [built, station, shownLevel, builtLevel])
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
  const open = (id: string | null) => {
    setPicked(null)
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('craft')
      if (id) next.set('module', id); else next.delete('module')
      return next
    })
  }
  return <section className={`hv${station ? ' has-module' : ''}`} aria-label={uiText('Убежище')}>
    <div className="hv-view">
      <div className="hv-stage-scroll" ref={scroller}>
        <div className="hv-stage" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
          <HideoutPicture stations={stations} built={view} christmas={hasTree && christmas} preview={station && shownLevel !== builtLevel ? station.id : undefined} />
          {stations.map((entry) => {
            const spot = moduleSpot(entry.id)
            // a module behind the wall not broken yet is not shown at all (owner, 20.11.2026: «если стена не снесена, значит,
            // модули за этой стенкой не отображаются… Все, что до этого, показывается»)
            if (!spot || (walledIn(entry.id) && entry.id !== openId)) return null
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
      {hasTree && <button type="button" className={`hv-tree${christmas ? ' is-on' : ''}`} aria-pressed={christmas} onClick={toggleChristmas}>
        <TreePine size={14} aria-hidden="true" /> {uiText('Ёлка')}
      </button>}
      {station && <ModulePanel key={station.id} locked={walledIn(station.id)} station={station} stations={stations} built={built} found={found} items={items}
        economy={economy.data} craftId={craftId} shownLevel={shownLevel} onShow={(level) => setPicked({ id: station.id, level })}
        onClose={() => open(null)} onLevel={(level) => state.setHideoutLevel(station.id, level)} />}
    </div>
  </section>
}

/** The phone's module window: at least so tall, and this far above the tab bar. */
const PHONE_ROOM = 240
const PHONE_GAP = 10

/** The element the page scrolls in (the app's main pane or the document). */
function scrollingParent(element: HTMLElement): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return document.scrollingElement
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
  /** The level looked at: its needs, its crafts, and the module drawn at it on the picture. */
  shownLevel: number
  onShow: (level: number) => void
  onClose: () => void
  onLevel: (level: number) => void
}

/**
 * A module's window as in the game (owner, 20.11.2026: «не на весь экран должно открываться, а открывается частично, как в игре… на 1/3
 * экрана окошечко, и в нем мой уровень и что требуется»): beside the picture, which stays in sight. The level buttons show one level at a
 * time — what it takes and its crafts — and the picture shows the module at that level; «Построил» / «Снять уровень» set the player's own.
 */
function ModulePanel({ station, locked, stations, built, found, items, economy, craftId, shownLevel, onShow, onClose, onLevel }: ModulePanelProps) {
  const level = built[station.id] ?? 0
  const max = station.levels?.length ?? 0
  const stages = [...(station.levels ?? [])].sort((a, b) => a.level - b.level)
  const stage = stages.find((entry) => entry.level === shownLevel)
  const crafts = (economy?.crafts ?? []).filter((craft) => craft.stationId === station.id && craft.level === shownLevel).sort((a, b) => a.duration - b.duration)
  // The phone (owner, 21.11.2026: «окно… открывалось не поверх модуля убежища… убежище должно быть видно»): the window under the
  // picture, as tall as the room down to the tab bar, scrolled inside; with less than PHONE_ROOM there, the page comes up by the rest.
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const node = panel.current
    if (!node || typeof window === 'undefined' || !window.matchMedia?.('(max-width: 700px)').matches) return
    const room = () => Math.floor((document.querySelector('.mobile-tabbar')?.getBoundingClientRect().top ?? window.innerHeight) - PHONE_GAP - node.getBoundingClientRect().top)
    const short = PHONE_ROOM - room()
    if (short > 0) scrollingParent(node)?.scrollBy({ top: short })
    const fit = () => { node.style.maxHeight = `${Math.max(PHONE_ROOM, room())}px` }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [station.id])
  return <aside ref={panel} className="panel hv-panel" aria-label={uiText(station.name)}>
    <button type="button" className="icon-button hv-panel-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={16} /></button>
    <header className="hv-panel-head">
      {stationIcon(station) && <img src={stationIcon(station)} alt="" />}
      <div>
        <h2>{uiText(station.name)}</h2>
        <span className="dim">{uiText('Мой уровень')}: {level ? `${roman(level)} / ${roman(max)}` : uiText('не построен')}</span>
      </div>
    </header>
    {locked && <p className="hv-locked-note"><Lock size={12} aria-hidden="true" /> {uiText('За аварийной стеной: откроется с её уровня')} {roman(roomsInfo!.openLevel)}</p>}
    <div className="hv-level-tabs" role="tablist" aria-label={uiText('Уровни')}>
      {stages.map((entry) => <button key={entry.level} type="button" role="tab" aria-selected={entry.level === shownLevel}
        className={`${entry.level <= level ? 'is-built' : ''}${entry.level === shownLevel ? ' is-shown' : ''}`} onClick={() => onShow(entry.level)}
        title={entry.level <= level ? uiText('построен') : uiText('не построен')}>
        {uiText('Уровень')} {roman(entry.level)}{entry.level <= level && <Check size={11} aria-hidden="true" />}
      </button>)}
    </div>
    {stage && <Requirements key={`${station.id}:${stage.level}`} stage={stage} stations={stations} built={built} found={found} items={items} economy={economy}
      builtLevel={level} onLevel={onLevel} />}
    {crafts.length > 0 && <Crafts crafts={crafts} shownLevel={shownLevel} builtLevel={level} items={items} craftId={craftId} />}
  </aside>
}

interface RequirementsProps {
  stage: Stage
  stations: readonly HideoutStation[]
  built: Record<string, number>
  found: ReadonlyMap<string, number>
  items: ReadonlyMap<string, Item>
  economy?: EconomySnapshot
  /** The player's own level of the module. */
  builtLevel: number
  onLevel: (level: number) => void
}

/**
 * What a level takes. An item to be found in raid (the tick) says at once where it can be made — the craft, the module and what goes
 * into it — and whether the cultist circle gives it (owner, 20.11.2026: «если есть предмет с галочкой, то указывать, можно ли его
 * скрафтить, где… и какие предметы нужны для крафта. И если он есть в круге сектантов… указывай на это тоже»); a barter does not give
 * it found in raid. Any other item shows where to get it on a press.
 */
function Requirements({ stage, stations, built, found, items, economy, builtLevel, onLevel }: RequirementsProps) {
  // (keyed by module and level: another level starts with no item open)
  const [itemId, setItemId] = useState<string | null>(null)
  const done = stage.level <= builtLevel
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
  return <div className={`hv-requirements${done ? ' is-done' : ''}`}>
    <h3>{uiText('Для уровня')} {roman(stage.level)}{done && <span className="hv-done-mark"><Check size={12} aria-hidden="true" /> {uiText('построен')}</span>}</h3>
    {goods.length > 0 && <ul className="hv-items">{goods.map((requirement) => {
      const have = done ? requirement.count : Math.min(requirement.count, found.get(requirement.itemId) ?? 0)
      const item = items.get(requirement.itemId)
      const picked = itemId === requirement.itemId
      return <li key={requirement.itemId} className={`${have >= requirement.count ? 'is-have' : ''}${picked ? ' is-picked' : ''}`}>
        <button type="button" className="hv-item" aria-expanded={(requirement.foundInRaid && !done) || picked} onClick={() => setItemId(picked ? null : requirement.itemId)} title={uiText('Где взять')}>
          <span className="hv-item-picture"><StashPicture id={requirement.itemId} item={item} /></span>
          <span className="hv-item-name">{uiText(item?.name ?? requirement.itemId)}{requirement.foundInRaid && <Check size={11} className="hv-fir" aria-label={uiText('найден в рейде')} />}</span>
          <strong className="hv-item-count">{have}/{requirement.count}</strong>
        </button>
        {requirement.foundInRaid && !done
          ? <ItemSources itemId={requirement.itemId} economy={economy} items={items} stations={stations} built={built} foundInRaid />
          : picked && <ItemSources itemId={requirement.itemId} economy={economy} items={items} stations={stations} built={built} />}
      </li>
    })}</ul>}
    {money.length > 0 && <p className="hv-money">{money.map((requirement) => `${number(requirement.count)} ${MONEY[requirement.itemId]}`).join(' · ')}</p>}
    {others.length > 0 && <ul className="hv-others">{others.map((line) => <li key={line} className={done || moduleDone(line) ? 'is-have' : ''}>{done || moduleDone(line) ? <Check size={11} aria-hidden="true" /> : <Lock size={11} aria-hidden="true" />} {uiText(line)}</li>)}</ul>}
    {stage.constructionTimeHours ? <p className="dim hv-time">{uiText('Строится')}: {uiText(formatDuration(stage.constructionTimeHours * 3600))}</p> : null}
    {done
      ? <button type="button" className="button small ghost hv-mark" onClick={() => onLevel(stage.level - 1)}>{uiText('Снять уровень')} {roman(stage.level)}</button>
      : <button type="button" className={`button small ${ready ? 'primary' : 'ghost'} hv-mark`} onClick={() => onLevel(stage.level)}><Check size={13} aria-hidden="true" /> {uiText('Построил')} {roman(stage.level)}</button>}
  </div>
}

/**
 * The crafts the level opens, folded under «Крафты» (owner, 20.11.2026: «Нажимаешь крафт, и он показывает список того, что можно
 * скрафтить. Не нужно этот список изначально раскладывать от верху до низу»): open, one row per craft — what comes out and how long
 * it takes — and a row opens what goes in («Должно быть понятно, что требуется для крафта и что мы получим»). A craft asked for
 * («Открыть модуль» in «Где взять») comes open.
 */
function Crafts({ crafts, shownLevel, builtLevel, items, craftId }: { crafts: readonly Craft[]; shownLevel: number; builtLevel: number; items: ReadonlyMap<string, Item>; craftId: string | null }) {
  const [open, setOpen] = useState(() => Boolean(craftId))
  const [picked, setPicked] = useState<string | null>(craftId)
  // another craft asked for while the window is open
  const [asked, setAsked] = useState(craftId)
  if (craftId !== asked) {
    setAsked(craftId)
    if (craftId) { setOpen(true); setPicked(craftId) }
  }
  useEffect(() => {
    if (craftId) document.getElementById(`hv-craft-${craftId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [craftId])
  const name = (itemId: string) => uiText(items.get(itemId)?.name ?? itemId)
  const lines = (list: Craft['requiredItems']) => <ul className="hv-craft-lines">{list.map((line) => <li key={line.itemId}>
    <span className="hv-craft-picture"><StashPicture id={line.itemId} item={items.get(line.itemId)} /></span>
    <span className="hv-craft-name">{name(line.itemId)}</span>
    <strong>×{line.count}</strong>
  </li>)}</ul>
  return <div className={`hv-crafts${shownLevel > builtLevel ? ' is-locked' : ''}`}>
    <button type="button" className="hv-crafts-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Hammer size={14} aria-hidden="true" /> {uiText('Крафты уровня')} {roman(shownLevel)}
      <span className="hv-crafts-count">{crafts.length}</span>
      <ChevronDown size={14} className="hv-source-chevron" aria-hidden="true" />
    </button>
    {open && <ul>{crafts.map((craft) => {
      const reward = craft.rewardItems[0]
      const shown = picked === craft.id
      return <li key={craft.id} id={`hv-craft-${craft.id}`} className={`hv-craft${craft.id === craftId ? ' is-target' : ''}${shown ? ' is-open' : ''}`}>
        <button type="button" className="hv-craft-row" aria-expanded={shown} onClick={() => setPicked(shown ? null : craft.id)}>
          <span className="hv-craft-picture">{reward && <StashPicture id={reward.itemId} item={items.get(reward.itemId)} />}</span>
          <span className="hv-craft-name">{reward ? `${name(reward.itemId)} ×${reward.count}` : ''}{craft.rewardItems.length > 1 ? ` +${craft.rewardItems.length - 1}` : ''}</span>
          <span className="hv-craft-time">{uiText(formatDuration(craft.duration))}</span>
          <ChevronDown size={14} className="hv-source-chevron" aria-hidden="true" />
        </button>
        {shown && <div className="hv-craft-detail">
          <div className="hv-craft-part"><span className="hv-craft-label">{uiText('Нужно')}</span>{lines(craft.requiredItems)}</div>
          <div className="hv-craft-part"><span className="hv-craft-label">{uiText('Получите')}</span>{lines(craft.rewardItems)}</div>
          {craft.taskUnlock && <p className="dim hv-craft-time">{uiText('после квеста')} {uiText(craft.taskUnlock.name)}</p>}
        </div>}
      </li>
    })}</ul>}
  </div>
}
