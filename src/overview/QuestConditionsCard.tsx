import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useBlockTitle } from './blockTitle'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Crosshair, MapPinned, Package, X } from 'lucide-react'
import type { GameMap, Item, ItemRef, ObjectiveConditions, QuestObjective } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { allConditionPieces, bodyPartWord, conditionPieces, distanceText, targetWord, timeText } from './conditionText'
import { gearObjectives, objectiveOnMap, stablePick, type ConditionQuest, type MapConditionQuests } from './questConditions'
import { usePictures, type Pictures } from './usePictures'
import '../gunsmith/gunsmith.css'
import '../styles/questConditions.css'

/** How many pictures of one kind the card shows at rest before «+N». */
const CARD_PARTS = 3
/** Map chips the card shows at rest. */
const CARD_MAPS = 2

/** The item's icon: the catalog's, else the same image folder by id; no other host. */
function iconOf(id: string, pictures: Pictures) {
  return pictures.items.get(id)?.iconUrl ?? pictures.iconBase?.replace(/[0-9a-f]{24}-icon\.webp$/, `${id}-icon.webp`)
}

/** The whole weapon: its default preset's picture, else its icon. */
function weaponPictureOf(id: string, pictures: Pictures) {
  return pictures.items.get(id)?.presetImageUrl ?? iconOf(id, pictures)
}

/** One of each item: tarkov.dev may list an item in two options of «any one of». */
function distinct(refs: ItemRef[]): ItemRef[] {
  const seen = new Set<string>()
  return refs.filter((ref) => !seen.has(ref.id) && Boolean(seen.add(ref.id)))
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

function MapChips({ objective, mapName, limit = CARD_MAPS }: { objective: Pick<QuestObjective, 'mapIds'>; mapName: (id: string) => string; limit?: number }) {
  const ids = objective.mapIds ?? []
  if (!ids.length) return <span className="qc-chips"><span className="qc-chip is-any">{uiText('Любая карта')}</span></span>
  return <span className="qc-chips">
    {ids.slice(0, limit).map((id) => <span key={id} className="qc-chip">{uiText(mapName(id))}</span>)}
    {ids.length > limit && <span className="qc-chip is-more" title={ids.slice(limit).map((id) => uiText(mapName(id))).join(', ')}>+{ids.length - limit}</span>}
  </span>
}

function ItemIcon({ item, pictures }: { item: ItemRef; pictures: Pictures }) {
  return <Picture className="qc-icon" src={iconOf(item.id, pictures)} alt={uiText(nameOf(item, pictures))} fallback={<Package size={12} />} />
}

/**
 * A choice is one example, never a long list (owner, 15.10.2026: «не должно быть огромных списков! коротко и понятно,
 * если конкретная вещь или оружие, показывай его, если нет, на выбор, то любая из допустимого»): the cheapest item on
 * the flea market, else the first.
 */
function exampleOf(refs: ItemRef[], pictures: Pictures): ItemRef {
  const price = (ref: ItemRef) => pictures.items.get(ref.id)?.fleaPrice || Infinity
  return refs.reduce((best, ref) => price(ref) < price(best) ? ref : best, refs[0])
}

/** «или любое из N» after the example of a choice. */
function ChoiceMore({ total, options }: { total: number; options?: boolean }) {
  return total > 1 ? <span className="qc-more qc-choice-more">{uiText(options ? `или другой вариант из ${total}` : `или любое из ${total}`)}</span> : null
}

/**
 * Parts or gear as the game asks for them, shortly: one option — every item of it (each is needed); a choice of single
 * items — one of them and «или любое из N»; a choice of sets — the first set and «или другой вариант из N».
 */
function shortOptions(options: ItemRef[][], pictures: Pictures): { refs: ItemRef[]; total: number; sets: boolean } {
  if (options.length === 1) return { refs: distinct(options[0]), total: 1, sets: false }
  const singles = distinct(options.flat())
  if (options.every((option) => option.length === 1)) return { refs: [exampleOf(singles, pictures)], total: singles.length, sets: false }
  return { refs: options[0], total: options.length, sets: true }
}

/**
 * The pictures of one objective at rest: the weapon (+N), the first few parts and gear (+N). Gear not to wear is never
 * shown (owner, 15.10.2026: «то что не нужно надевать, не показывай»).
 */
export function GearStrip({ conditions, pictures }: { conditions: ObjectiveConditions; pictures: Pictures }) {
  const weapon = conditions.weapons?.length ? exampleOf(conditions.weapons, pictures) : undefined
  const mods = conditions.mods?.[0] ?? []
  const wearing = conditions.wearing?.[0] ?? []
  const limit = CARD_PARTS
  const more = (count: number, title: string) => count > 0 && <span className="qc-more" title={uiText(title)}>+{count}</span>
  return <span className="qc-gear">
    {weapon && <span className="qc-weapon-group">
      <Picture className="qc-weapon" src={weaponPictureOf(weapon.id, pictures)} alt={uiText(nameOf(weapon, pictures))} fallback={<Crosshair size={16} />} />
      {more((conditions.weapons?.length ?? 0) - 1, 'Подходит и другое оружие из списка')}
    </span>}
    {mods.length > 0 && <span className="qc-icon-group is-mods">
      {mods.slice(0, limit).map((ref) => <ItemIcon key={ref.id} item={ref} pictures={pictures} />)}
      {more(Math.max(0, mods.length - limit) + ((conditions.mods?.length ?? 1) - 1), 'Есть и другие варианты модулей')}
    </span>}
    {wearing.length > 0 && <span className="qc-icon-group is-wearing">
      {wearing.slice(0, limit).map((ref) => <ItemIcon key={ref.id} item={ref} pictures={pictures} />)}
      {more(Math.max(0, wearing.length - limit) + ((conditions.wearing?.length ?? 1) - 1), 'Есть и другие варианты снаряжения')}
    </span>}
  </span>
}

/** Parts or gear in the unfolded card, shortly (shortOptions). */
function FullOptions({ kind, title, options, pictures }: { kind: string; title: string; options: ItemRef[][]; pictures: Pictures }) {
  const short = shortOptions(options, pictures)
  return <span className={`qc-full-row is-${kind}`}>
    <span className="qc-full-label">{uiText(title)}</span>
    <span className="qc-full-items">
      {short.refs.map((ref) => <ItemIcon key={ref.id} item={ref} pictures={pictures} />)}
      <ChoiceMore total={short.total} options={short.sets} />
    </span>
  </span>
}

/** One objective unfolded: the weapon, the parts and the gear (one example of a choice), every condition and map. */
function FullObjective({ objective, pictures, mapName }: { objective: QuestObjective; pictures: Pictures; mapName: (id: string) => string }) {
  const conditions = objective.conditions ?? {}
  const pieces = allConditionPieces(objective)
  return <span className="qc-full-objective">
    {conditions.weapons?.length ? <span className="qc-full-row is-weapons">
      <span className="qc-full-label">{uiText('Оружие')}</span>
      <span className="qc-full-items">
        {(() => {
          const weapon = exampleOf(conditions.weapons, pictures)
          return <Picture className="qc-weapon" src={weaponPictureOf(weapon.id, pictures)} alt={uiText(nameOf(weapon, pictures))} fallback={<Crosshair size={16} />} />
        })()}
        <ChoiceMore total={conditions.weapons.length} />
      </span>
    </span> : null}
    {conditions.mods?.length ? <FullOptions kind="mods" title="Модули на оружии" options={conditions.mods} pictures={pictures} /> : null}
    {conditions.wearing?.length ? <FullOptions kind="wearing" title="Надеть" options={conditions.wearing} pictures={pictures} /> : null}
    <span className="qc-meta is-full">
      <MapChips objective={objective} mapName={mapName} limit={Infinity} />
      {pieces.length > 0 && <span className="qc-line">{pieces.map((piece) => uiText(piece)).join(' · ')}</span>}
    </span>
  </span>
}

/** The card at rest hides something: another weapon, part, gear option or map, a second objective, a zone or an effect. */
function hasMoreToShow(entry: ConditionQuest): boolean {
  if (entry.objectives.length > 1) return true
  const objective = entry.objectives[0]
  const conditions = objective?.conditions ?? {}
  const options = (list: ItemRef[][] | undefined) => (list?.length ?? 0) > 1 || (list?.[0]?.length ?? 0) > CARD_PARTS
  return (conditions.weapons?.length ?? 0) > 1 || options(conditions.mods) || options(conditions.wearing)
    || (objective?.mapIds?.length ?? 0) > CARD_MAPS || allConditionPieces(objective ?? { count: 1 }).length > conditionPieces(objective ?? { count: 1 }).length
}

/**
 * One quest as a card, the same in the Overview card and in its unfolded list: at rest the name, the weapon, the first
 * parts and gear with «+N», the maps and the short line; `full` — every picture, every condition and every map.
 * `expandable` (a card of the unfolded list): both are rendered and the stylesheet shows the full one on hover, focus or
 * `full`, so a tap never swaps the element under the finger between pointerdown and click (the click would be lost).
 */
function QuestCard({ entry, pictures, mapName, full, expandable, className = '', onOpen, ...events }: {
  entry: ConditionQuest
  pictures: Pictures
  mapName: (id: string) => string
  full?: boolean
  expandable?: boolean
  className?: string
  onOpen: () => void
  onPointerEnter?: (event: ReactPointerEvent) => void
  onPointerLeave?: (event: ReactPointerEvent) => void
  onFocus?: () => void
  onBlur?: () => void
}) {
  const objective = entry.objectives[0]
  const pieces = objective ? conditionPieces(objective) : []
  const rest = <span className="qc-rest">
    {objective?.conditions && <GearStrip conditions={objective.conditions} pictures={pictures} />}
    <span className="qc-meta">
      {objective && <MapChips objective={objective} mapName={mapName} />}
      {pieces.length > 0 && <span className="qc-line">{pieces.map((piece) => uiText(piece)).join(' · ')}</span>}
    </span>
  </span>
  const all = <span className="qc-all">
    {entry.objectives.map((entryObjective) => <FullObjective key={entryObjective.id} objective={entryObjective} pictures={pictures} mapName={mapName} />)}
  </span>
  return <button type="button" className={`qc-main qc-card${full ? ' is-full' : ''}${expandable ? ' is-expandable' : ''}${className ? ` ${className}` : ''}`} aria-haspopup="dialog"
    title={uiText('Подробнее о сборке и предметах')} onClick={onOpen} {...events}>
    <strong className="qc-name">{uiText(entry.quest.name)}</strong>
    {expandable ? <>{rest}{all}</> : full ? all : rest}
  </button>
}

/**
 * The Overview card «Сбор на рейд» (was «Условия квестов»): one quest of the raid plan's map with a gear condition, picked at random and kept
 * while the map and the quests stay the same. Hovering it unfolds the card over the grid (owner, 15.10.2026: «они должны
 * быть не уменьшеные, а полноценные как и основной блок»): the card's quest with all of its info, and every other such
 * quest below as the same full-size card, which shows all of its info in turn when pointed at. A touch: «ещё N». A click
 * on any card opens the whole build.
 */
export function QuestConditionsCard({ result, map, mapName, items, pickKey }: {
  result: MapConditionQuests
  map: GameMap
  mapName: (id: string) => string
  items: Item[]
  /** Mode and map: the random pick is made again when it changes. */
  pickKey: string
}) {
  const pictures = usePictures(items)
  const title = useBlockTitle('Сбор на рейд')
  const ids = result.quests.map((entry) => entry.quest.id)
  const picked = stablePick(ids, pickKey)
  // A quest opened from the list stays in the card until the map or the quests change.
  const [chosen, setChosen] = useState<{ key: string; id: string } | undefined>()
  const setKey = `${pickKey}|${ids.join(',')}`
  const shownId = chosen?.key === setKey && ids.includes(chosen.id) ? chosen.id : picked
  const shown = result.quests.find((entry) => entry.quest.id === shownId)
  const others = result.quests.filter((entry) => entry !== shown)
  const unfoldable = Boolean(shown && (others.length > 0 || hasMoreToShow(shown)))
  // Unfolded for one map: another map folds it.
  const [openFor, setOpenFor] = useState<string | undefined>()
  const open = unfoldable && openFor === pickKey
  // «ещё N» pins it open (a touch, or a click after hovering); hovering alone opens it until the mouse leaves.
  const pinned = useRef(false)
  // The list card the pointer or the focus is on shows all of its info.
  const [pointed, setPointed] = useState<string | undefined>()
  const [details, setDetails] = useState<ConditionQuest | undefined>()
  const popId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const foldRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  // A tap outside folds it (touch has no «mouse left»); Escape folds it too.
  useEffect(() => {
    if (!open) return
    const close = () => { pinned.current = false; setOpenFor(undefined) }
    const onDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  // It unfolds from the card's left edge, or from its right edge when it would leave the window there (the right
  // half-wide card on the phone).
  const [alignEnd, setAlignEnd] = useState(false)
  const measure = () => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.max(rect.width, Math.min(380, window.innerWidth - 32))
    setAlignEnd(rect.left + width > window.innerWidth - 8)
  }
  const hoverOpen = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse' || !unfoldable) return
    window.clearTimeout(closeTimer.current)
    measure()
    setOpenFor(pickKey)
  }
  const hoverClose = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse' || pinned.current) return
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => { setOpenFor(undefined); setPointed(undefined) }, 160)
  }
  const unfold = () => {
    window.clearTimeout(closeTimer.current)
    pinned.current = true
    measure()
    setOpenFor(pickKey)
    // The keyboard goes on inside the unfolded card.
    window.setTimeout(() => foldRef.current?.focus({ preventScroll: true }), 0)
  }
  const fold = () => { window.clearTimeout(closeTimer.current); pinned.current = false; setOpenFor(undefined); setPointed(undefined) }
  const openDetails = (entry: ConditionQuest) => {
    if (entry !== shown) setChosen({ key: setKey, id: entry.quest.id })
    fold()
    setDetails(entry)
  }
  const label = title

  return <div ref={rootRef} className={`stat-card quest-conditions-card${open ? ' is-listing' : ''}`} onPointerEnter={hoverOpen} onPointerLeave={hoverClose}>
    <div className="qc-head">
      <div className="stat-label">{label}</div>
      {others.length > 0 && <button type="button" className="qc-count" aria-expanded={open} aria-controls={popId} onClick={() => open && pinned.current ? fold() : unfold()}>
        {uiText(`ещё ${others.length}`)}<ChevronDown size={12} aria-hidden="true" />
      </button>}
    </div>
    {shown
      ? <QuestCard entry={shown} pictures={pictures} mapName={mapName} onOpen={() => openDetails(shown)} />
      : <p className="qc-empty">{uiText('На этой карте нет квестов с условиями на снаряжение')}</p>}
    {unfoldable && shown && <div id={popId} className={`qc-pop${open ? ' is-open' : ''}${alignEnd ? ' is-end' : ''}`} inert={!open} role="group" aria-label={uiText(`Сбор на рейд · ${uiText(map.name)}`)}>
      <div className="qc-head">
        <div className="stat-label">{label}</div>
        <button ref={foldRef} type="button" className="qc-count" aria-expanded={open} aria-controls={popId} onClick={fold}>
          {uiText(others.length ? `ещё ${others.length}` : 'Свернуть')}<ChevronDown size={12} aria-hidden="true" />
        </button>
      </div>
      <QuestCard entry={shown} pictures={pictures} mapName={mapName} full className="is-shown" onOpen={() => openDetails(shown)} />
      {others.length > 0 && <ul className="qc-list">
        {others.map((entry) => <li key={entry.quest.id}>
          <QuestCard entry={entry} pictures={pictures} mapName={mapName} expandable full={pointed === entry.quest.id} onOpen={() => openDetails(entry)}
            onPointerEnter={(event) => { if (event.pointerType === 'mouse') setPointed(entry.quest.id) }}
            onPointerLeave={(event) => { if (event.pointerType === 'mouse') setPointed((id) => id === entry.quest.id ? undefined : id) }}
            onFocus={() => setPointed(entry.quest.id)}
            onBlur={() => setPointed((id) => id === entry.quest.id ? undefined : id)} />
        </li>)}
      </ul>}
    </div>}
    {details && <QuestConditionsDialog entry={details} mapId={map.id} mapName={mapName} pictures={pictures} onClose={() => setDetails(undefined)} />}
  </div>
}

function ItemCard({ item, pictures }: { item: ItemRef; pictures: Pictures }) {
  const catalog = pictures.items.get(item.id)
  const name = nameOf(item, pictures)
  return <Link className="gs-part qc-part" to={`/flea?selected=${encodeURIComponent(item.id)}`} title={uiText(name)}>
    <span className="qc-part-picture">
      <Picture src={iconOf(item.id, pictures)} alt={uiText(name)} fallback={<Package size={18} />} />
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

/** Parts or gear in the dialog, shortly (shortOptions): the items to take and «или любое из N» for a choice. */
function OptionGroups({ title, options, pictures }: { title: string; options: ItemRef[][]; pictures: Pictures }) {
  const short = shortOptions(options, pictures)
  return <div className="gs-block qc-block">
    <h5>{uiText(title)} {short.total === 1 && short.refs.length > 1 && <small>{uiText('все вместе')}</small>}</h5>
    <div className="gs-parts">{short.refs.map((ref) => <ItemCard key={ref.id} item={ref} pictures={pictures} />)}</div>
    <ChoiceMore total={short.total} options={short.sets} />
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

/**
 * What to take into the raid for these objectives, shortly: the weapon in a large picture, the parts and the gear (one
 * example of a choice) and every condition. The dialog's body.
 */
export function QuestBuild({ objectives, mapId, mapName, pictures, texts = true }: { objectives: QuestObjective[]; mapId: string; mapName: (id: string) => string; pictures: Pictures; texts?: boolean }) {
  return <>
    {objectives.map((objective) => {
      const conditions = objective.conditions ?? {}
      const here = objectiveOnMap(objective, mapId)
      return <article key={objective.id} className={`qc-objective${here ? ' is-here' : ''}`}>
        {texts && objective.description && <p className="qc-objective-text">{uiText(objective.description)}</p>}
        {conditions.weapons?.length ? <div className="gs-block qc-block">
          <h5>{uiText('Оружие')}</h5>
          <div className="qc-weapons is-single"><WeaponCard weapon={exampleOf(conditions.weapons, pictures)} pictures={pictures} /></div>
          <ChoiceMore total={conditions.weapons.length} />
        </div> : null}
        {conditions.mods?.length ? <OptionGroups title="Модули на оружии" options={conditions.mods} pictures={pictures} /> : null}
        {conditions.wearing?.length ? <OptionGroups title="Надеть" options={conditions.wearing} pictures={pictures} /> : null}
        <div className="gs-block qc-block">
          <h5>{uiText('Условия убийства')}</h5>
          <ConditionFacts objective={objective} mapName={mapName} />
        </div>
      </article>
    })}
  </>
}

/**
 * The whole quest in a dialog: each objective with conditions (QuestBuild). `mapLink`: «Показать на карте» for a quest
 * opened from «Текущие задания».
 */
export function QuestConditionsDialog({ entry, mapId, mapName, pictures, onClose, mapLink }: { entry: ConditionQuest; mapId: string; mapName: (id: string) => string; pictures: Pictures; onClose: () => void; mapLink?: string }) {
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
  // The objectives of this map first; the others of the quest after them.
  const objectives = [...gearObjectives(quest)].sort((a, b) => Number(objectiveOnMap(b, mapId)) - Number(objectiveOnMap(a, mapId)))
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
          {mapLink && <Link className="button small ghost" to={mapLink} onClick={onClose}><MapPinned size={13} /> {uiText('Показать на карте')}</Link>}
          <Link className="button small" to={`/quests?selected=${encodeURIComponent(quest.id)}`} onClick={onClose}>{uiText('Открыть квест')} <ChevronRight size={13} /></Link>
          <button ref={closeRef} type="button" className="icon-button qc-dialog-close" aria-label={uiText('Закрыть')} title={uiText('Закрыть')} onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div className="panel-body">
        <QuestBuild objectives={objectives} mapId={mapId} mapName={mapName} pictures={pictures} />
      </div>
    </section>
  </div>, document.body)
}
