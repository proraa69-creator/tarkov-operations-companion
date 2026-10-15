import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Ban, ChevronDown, ChevronRight, Crosshair, Package, X } from 'lucide-react'
import type { GameMap, Item, ItemRef, ObjectiveConditions, QuestObjective } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { bodyPartWord, conditionPieces, distanceText, targetWord, timeText } from './conditionText'
import { gearObjectives, objectiveOnMap, stablePick, type ConditionQuest, type MapConditionQuests } from './questConditions'
import '../gunsmith/gunsmith.css'
import '../styles/questConditions.css'

/** How many pictures of one kind the compact card shows before «+N». */
const CARD_PARTS = 3
/** Gear not to wear: the dialog shows this many before «ещё N». */
const NOT_WEARING_SHOWN = 24

interface Pictures {
  items: Map<string, Item>
  /** A catalog icon address to derive another item's icon from (the server's own image folder or tarkov.dev). */
  iconBase?: string
}

/** The item's icon: the catalog's, else the same image folder by id; no other host. */
function iconOf(id: string, pictures: Pictures) {
  return pictures.items.get(id)?.iconUrl ?? pictures.iconBase?.replace(/[0-9a-f]{24}-icon\.webp$/, `${id}-icon.webp`)
}

/** The whole weapon: its default preset's picture, else its icon. */
function weaponPictureOf(id: string, pictures: Pictures) {
  return pictures.items.get(id)?.presetImageUrl ?? iconOf(id, pictures)
}

function nameOf(ref: ItemRef, pictures: Pictures) {
  return pictures.items.get(ref.id)?.name ?? ref.name
}

function Picture({ src, alt, className, fallback }: { src?: string; alt: string; className?: string; fallback: ReactNode }) {
  const [broken, setBroken] = useState<string | undefined>()
  return src && broken !== src
    ? <img className={className} src={src} alt={alt} title={alt} loading="lazy" onError={() => setBroken(src)} />
    : <span className={`${className ?? ''} is-empty`} title={alt} role="img" aria-label={alt}>{fallback}</span>
}

function MapChips({ objective, mapName, limit = 2 }: { objective: Pick<QuestObjective, 'mapIds'>; mapName: (id: string) => string; limit?: number }) {
  const ids = objective.mapIds ?? []
  if (!ids.length) return <span className="qc-chips"><span className="qc-chip is-any">{uiText('Любая карта')}</span></span>
  return <span className="qc-chips">
    {ids.slice(0, limit).map((id) => <span key={id} className="qc-chip">{uiText(mapName(id))}</span>)}
    {ids.length > limit && <span className="qc-chip is-more" title={ids.slice(limit).map((id) => uiText(mapName(id))).join(', ')}>+{ids.length - limit}</span>}
  </span>
}

/** The pictures of one objective: weapon (+N), the first part option, the first gear option, gear not to wear. */
function GearStrip({ conditions, pictures, tiny }: { conditions: ObjectiveConditions; pictures: Pictures; tiny?: boolean }) {
  const weapon = conditions.weapons?.[0]
  const mods = conditions.mods?.[0] ?? []
  const wearing = conditions.wearing?.[0] ?? []
  const notWearing = conditions.notWearing ?? []
  const limit = tiny ? 2 : CARD_PARTS
  const more = (count: number, title: string) => count > 0 && <span className="qc-more" title={uiText(title)}>+{count}</span>
  return <span className={`qc-gear${tiny ? ' is-tiny' : ''}`}>
    {weapon && <span className="qc-weapon-group">
      <Picture className="qc-weapon" src={(tiny ? iconOf : weaponPictureOf)(weapon.id, pictures)} alt={nameOf(weapon, pictures)} fallback={<Crosshair size={tiny ? 12 : 16} />} />
      {more((conditions.weapons?.length ?? 0) - 1, 'Подходит и другое оружие из списка')}
    </span>}
    {mods.length > 0 && <span className="qc-icon-group is-mods">
      {mods.slice(0, limit).map((ref) => <Picture key={ref.id} className="qc-icon" src={iconOf(ref.id, pictures)} alt={nameOf(ref, pictures)} fallback={<Package size={12} />} />)}
      {more(mods.length - limit + ((conditions.mods?.length ?? 1) - 1), 'Есть и другие варианты модулей')}
    </span>}
    {wearing.length > 0 && <span className="qc-icon-group is-wearing">
      {wearing.slice(0, limit).map((ref) => <Picture key={ref.id} className="qc-icon" src={iconOf(ref.id, pictures)} alt={nameOf(ref, pictures)} fallback={<Package size={12} />} />)}
      {more(Math.max(0, wearing.length - limit) + ((conditions.wearing?.length ?? 1) - 1), 'Есть и другие варианты снаряжения')}
    </span>}
    {notWearing.length > 0 && <span className="qc-icon-group is-not-wearing" title={uiText('Нельзя надевать')}>
      <span className="qc-ban"><Picture className="qc-icon" src={iconOf(notWearing[0].id, pictures)} alt={nameOf(notWearing[0], pictures)} fallback={<Package size={12} />} /><Ban size={tiny ? 10 : 12} aria-hidden="true" /></span>
      {more(notWearing.length - 1, 'Нельзя надевать')}
    </span>}
  </span>
}

/**
 * The Overview card «Условия квестов»: one quest of the raid plan's map with a gear condition, picked at random and kept
 * while the map and the quests stay the same. Hovering it unfolds every such quest below (a touch: «ещё N»); a row shows
 * its quest in the card; a click on the card opens the whole build and every condition.
 */
export function QuestConditionsCard({ result, map, mapName, items, pickKey }: {
  result: MapConditionQuests
  map: GameMap
  mapName: (id: string) => string
  items: Item[]
  /** Mode and map: the random pick is made again when it changes. */
  pickKey: string
}) {
  const pictures = useMemo<Pictures>(() => ({
    items: new Map(items.map((item) => [item.id, item])),
    iconBase: items.map((item) => item.iconUrl).find((url): url is string => Boolean(url && /\/[0-9a-f]{24}-icon\.webp$/.test(url))),
  }), [items])
  const ids = result.quests.map((entry) => entry.quest.id)
  const picked = stablePick(ids, pickKey)
  // A row the player pointed at stays in the card until the map or the quests change.
  const [chosen, setChosen] = useState<{ key: string; id: string } | undefined>()
  const setKey = `${pickKey}|${ids.join(',')}`
  const shownId = chosen?.key === setKey && ids.includes(chosen.id) ? chosen.id : picked
  const shown = result.quests.find((entry) => entry.quest.id === shownId)
  // The list is open for one map: another map folds it.
  const [openFor, setOpenFor] = useState<string | undefined>()
  const listOpen = openFor === pickKey
  // «ещё N» pins the list open (a touch, or a click after hovering); hovering alone opens it until the mouse leaves.
  const pinned = useRef(false)
  const [details, setDetails] = useState<ConditionQuest | undefined>()
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const several = result.quests.length > 1

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  // A tap outside folds the list (touch has no «mouse left»); Escape folds it too.
  useEffect(() => {
    if (!listOpen) return
    const close = () => { pinned.current = false; setOpenFor(undefined) }
    const onDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey) }
  }, [listOpen])

  const show = (id: string) => setChosen({ key: setKey, id })
  // The list unfolds from the card's left edge, or from its right edge when it would leave the window there (the right
  // half-wide card on the phone).
  const [alignEnd, setAlignEnd] = useState(false)
  const measure = () => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.max(rect.width, Math.min(340, window.innerWidth - 32))
    setAlignEnd(rect.left + width > window.innerWidth - 8)
  }
  const hoverOpen = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse' || !several) return
    window.clearTimeout(closeTimer.current)
    measure()
    setOpenFor(pickKey)
  }
  const hoverClose = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse' || pinned.current) return
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpenFor(undefined), 160)
  }
  const toggleList = () => {
    window.clearTimeout(closeTimer.current)
    const open = !(listOpen && pinned.current)
    pinned.current = open
    if (open) measure()
    setOpenFor(open ? pickKey : undefined)
  }
  const closeList = () => { pinned.current = false; setOpenFor(undefined) }

  const objective = shown?.objectives[0]
  const pieces = objective ? conditionPieces(objective) : []
  return <div ref={rootRef} className={`stat-card quest-conditions-card${listOpen ? ' is-listing' : ''}`} onPointerEnter={hoverOpen} onPointerLeave={hoverClose}>
    <div className="qc-head">
      <div className="stat-label">{uiText('Сбор на рейд')}</div>
      {several && <button type="button" className="qc-count" aria-expanded={listOpen} aria-controls={listId} onClick={toggleList}>
        {uiText(`ещё ${result.quests.length - 1}`)}<ChevronDown size={12} aria-hidden="true" />
      </button>}
    </div>
    {shown && objective?.conditions
      ? <button type="button" className="qc-main" aria-haspopup="dialog" onClick={() => setDetails(shown)} title={uiText('Подробнее о сборке и предметах')}>
        <strong className="qc-name">{uiText(shown.quest.name)}</strong>
        <GearStrip conditions={objective.conditions} pictures={pictures} />
        <span className="qc-meta">
          <MapChips objective={objective} mapName={mapName} />
          {pieces.length > 0 && <span className="qc-line">{pieces.map((piece) => uiText(piece)).join(' · ')}</span>}
        </span>
      </button>
      : <p className="qc-empty">{uiText('На этой карте нет квестов с условиями на снаряжение')}</p>}
    {several && <ul id={listId} className={`qc-list${listOpen ? ' is-open' : ''}${alignEnd ? ' is-end' : ''}`} inert={!listOpen} aria-label={uiText(`Сбор на рейд · ${uiText(map.name)}`)}>
      {result.quests.map((entry) => {
        const first = entry.objectives[0]
        return <li key={entry.quest.id}>
          <button type="button" className={`qc-row${entry.quest.id === shown?.quest.id ? ' is-shown' : ''}`}
            onPointerEnter={(event) => { if (event.pointerType === 'mouse') show(entry.quest.id) }}
            onFocus={() => show(entry.quest.id)}
            onClick={() => { show(entry.quest.id); closeList() }}>
            <span className="qc-row-copy">
              <strong>{uiText(entry.quest.name)}</strong>
              <MapChips objective={first} mapName={mapName} limit={1} />
            </span>
            {first.conditions && <GearStrip conditions={first.conditions} pictures={pictures} tiny />}
          </button>
        </li>
      })}
    </ul>}
    {details && <QuestConditionsDialog entry={details} mapId={map.id} mapName={mapName} pictures={pictures} onClose={() => setDetails(undefined)} />}
  </div>
}

function ItemCard({ item, pictures, banned }: { item: ItemRef; pictures: Pictures; banned?: boolean }) {
  const catalog = pictures.items.get(item.id)
  const name = nameOf(item, pictures)
  return <Link className={`gs-part qc-part${banned ? ' is-banned' : ''}`} to={`/flea?selected=${encodeURIComponent(item.id)}`} title={uiText(name)}>
    <span className="qc-part-picture">
      <Picture src={iconOf(item.id, pictures)} alt={uiText(name)} fallback={<Package size={18} />} />
      {banned && <Ban size={14} className="qc-part-ban" aria-hidden="true" />}
    </span>
    <span>
      <strong>{uiText(catalog?.shortName ?? name)}</strong>
      <small>{uiText(name)}</small>
    </span>
  </Link>
}

function WeaponCard({ weapon, pictures }: { weapon: ItemRef; pictures: Pictures }) {
  const name = nameOf(weapon, pictures)
  return <Link className="qc-weapon-card" to={`/flea?selected=${encodeURIComponent(weapon.id)}`} title={uiText(name)}>
    <Picture src={weaponPictureOf(weapon.id, pictures)} alt={uiText(name)} fallback={<Crosshair size={26} />} />
    <span>{uiText(name)}</span>
  </Link>
}

/** Options of parts or gear: one option = every item; several = any one of them («Вариант 1», …, or «Любой из»). */
function OptionGroups({ title, options, pictures }: { title: string; options: ItemRef[][]; pictures: Pictures }) {
  const singles = options.every((option) => option.length === 1)
  return <div className="gs-block qc-block">
    <h5>{uiText(title)} <small>{uiText(options.length === 1 ? (options[0].length > 1 ? 'все вместе' : '') : singles ? 'любой из' : 'любой из вариантов')}</small></h5>
    {options.length === 1 || singles
      ? <div className="gs-parts">{options.flat().map((ref) => <ItemCard key={ref.id} item={ref} pictures={pictures} />)}</div>
      : <ol className="qc-options">{options.map((option, index) => <li key={option.map((ref) => ref.id).join()}>
        <span className="qc-option-label">{uiText(`Вариант ${index + 1}`)}</span>
        <div className="gs-parts">{option.map((ref) => <ItemCard key={ref.id} item={ref} pictures={pictures} />)}</div>
      </li>)}</ol>}
  </div>
}

function ConditionFacts({ objective, mapName }: { objective: QuestObjective; mapName: (id: string) => string }) {
  const conditions = objective.conditions ?? {}
  const facts: Array<[string, string]> = [
    [conditions.hitOnly ? 'Попасть' : 'Убить', `×${objective.count}`],
    ...(conditions.targets?.length ? [['Противник', [...new Set(conditions.targets.map(targetWord))].map((word) => uiText(word)).join(', ')] as [string, string]] : []),
    ...(conditions.distance ? [['Дистанция', uiText(distanceText(conditions.distance))] as [string, string]] : []),
    ...(conditions.bodyParts?.length ? [['Части тела', [...new Set(conditions.bodyParts.map(bodyPartWord))].map((word) => uiText(word)).join(', ')] as [string, string]] : []),
    ...(conditions.zoneNames?.length ? [['Зоны', conditions.zoneNames.join(', ')] as [string, string]]
      : objective.zones?.length ? [['Зоны', uiText('только в зонах задания')] as [string, string]] : []),
    ...(conditions.time ? [['Время в игре', timeText(conditions.time)] as [string, string]] : []),
    ...(conditions.enemyEffects?.length ? [['Цель под эффектом', conditions.enemyEffects.join(', ')] as [string, string]] : []),
    ...(conditions.playerEffects?.length ? [['Вы под эффектом', conditions.playerEffects.join(', ')] as [string, string]] : []),
    ['Карты', objective.mapIds?.length ? objective.mapIds.map((id) => uiText(mapName(id))).join(', ') : uiText('Любая карта')],
  ]
  return <dl className="qc-facts">{facts.map(([label, value]) => <div key={label}><dt>{uiText(label)}</dt><dd>{value}</dd></div>)}</dl>
}

function NotWearing({ refs, pictures }: { refs: ItemRef[]; pictures: Pictures }) {
  const [all, setAll] = useState(false)
  const shown = all ? refs : refs.slice(0, NOT_WEARING_SHOWN)
  return <div className="gs-block qc-block">
    <h5>{uiText('Нельзя надевать')} <small>{uiText(`ничего из ${refs.length}`)}</small></h5>
    <div className="gs-parts qc-parts-small">{shown.map((ref) => <ItemCard key={ref.id} item={ref} pictures={pictures} banned />)}</div>
    {refs.length > shown.length && <button type="button" className="button small ghost qc-show-all" onClick={() => setAll(true)}>{uiText(`Показать все (${refs.length})`)}</button>}
  </div>
}

/** The whole quest: each objective with conditions — the weapons in large pictures, every part and gear option, every condition. */
export function QuestConditionsDialog({ entry, mapId, mapName, pictures, onClose }: { entry: ConditionQuest; mapId: string; mapName: (id: string) => string; pictures: Pictures; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeLatest = useRef(onClose)
  useEffect(() => { closeLatest.current = onClose })
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeLatest.current() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); opener?.focus() }
  }, [])
  const { quest } = entry
  const objectives = gearObjectives(quest)
  const titleId = useId()
  return createPortal(<div className="registration-overlay quest-conditions-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="panel quest-conditions-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="panel-header">
        <div className="qc-dialog-title">
          <span className="stat-label">{uiText('Сбор на рейд')}</span>
          <h3 id={titleId}>{uiText(quest.name)}</h3>
          <small>{uiText(quest.trader)}</small>
        </div>
        <div className="qc-dialog-actions">
          <Link className="button small" to={`/quests?selected=${encodeURIComponent(quest.id)}`} onClick={onClose}>{uiText('Открыть квест')} <ChevronRight size={13} /></Link>
          <button ref={closeRef} type="button" className="icon-button qc-dialog-close" aria-label={uiText('Закрыть')} title={uiText('Закрыть')} onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div className="panel-body">
        {objectives.map((objective) => {
          const conditions = objective.conditions!
          const here = objectiveOnMap(objective, mapId)
          return <article key={objective.id} className={`qc-objective${here ? ' is-here' : ''}`}>
            {objective.description && <p className="qc-objective-text">{uiText(objective.description)}</p>}
            {conditions.weapons?.length ? <div className="gs-block qc-block">
              <h5>{uiText('Оружие')} {conditions.weapons.length > 1 && <small>{uiText('любое из')}</small>}</h5>
              <div className={`qc-weapons${conditions.weapons.length === 1 ? ' is-single' : ''}`}>{conditions.weapons.map((ref) => <WeaponCard key={ref.id} weapon={ref} pictures={pictures} />)}</div>
            </div> : null}
            {conditions.mods?.length ? <OptionGroups title="Модули на оружии" options={conditions.mods} pictures={pictures} /> : null}
            {conditions.wearing?.length ? <OptionGroups title="Надеть" options={conditions.wearing} pictures={pictures} /> : null}
            {conditions.notWearing?.length ? <NotWearing refs={conditions.notWearing} pictures={pictures} /> : null}
            <div className="gs-block qc-block">
              <h5>{uiText('Условия убийства')}</h5>
              <ConditionFacts objective={objective} mapName={mapName} />
            </div>
          </article>
        })}
      </div>
    </section>
  </div>, document.body)
}
