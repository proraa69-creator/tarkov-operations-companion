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
import { CHOICE_POPUP_CLASS, ChoicePopover } from './ChoicePopover'
import '../gunsmith/gunsmith.css'
import '../styles/questConditions.css'
import bigPipeResting from '../assets/goons-rest/big-pipe.webp'
import birdeyeResting from '../assets/goons-rest/birdeye.webp'

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

/** How many variants a choice has: its sets, or its distinct items; one option (every item of it is needed) is no choice. */
function variantCount(options: ItemRef[][], sets: boolean) {
  if (options.length <= 1) return 1
  return sets ? options.length : distinct(options.flat()).length
}

/**
 * Every variant of a choice for its list (ChoicePopover): the example first, then the others; a weapon with its whole
 * picture, an item with its icon, each with its name; a set of items (`sets`) as one row of its items.
 */
function VariantList({ options, sets, weapons, example, pictures }: { options: ItemRef[][]; sets: boolean; weapons?: boolean; example?: ItemRef; pictures: Pictures }) {
  const cell = (ref: ItemRef, isExample = false) => {
    const name = uiText(nameOf(ref, pictures))
    return <li key={ref.id} className={`qc-variant${weapons ? ' is-weapon' : ''}${isExample ? ' is-example' : ''}`}>
      {weapons
        ? <Picture className="qc-variant-weapon" src={weaponPictureOf(ref.id, pictures)} alt={name} fallback={<Crosshair size={16} />} />
        : <Picture className="qc-icon" src={iconOf(ref.id, pictures)} alt={name} fallback={<Package size={12} />} />}
      <span className="qc-variant-name">{name}</span>
    </li>
  }
  if (sets) {
    return <ol className="qc-variants-sets">
      {options.map((option, index) => <li key={index}><ul className="qc-variants-grid">{distinct(option).map((ref) => cell(ref))}</ul></li>)}
    </ol>
  }
  const refs = distinct(options.flat())
  const first = example && refs.some((ref) => ref.id === example.id) ? example : refs[0]
  return <ul className={`qc-variants-grid${weapons ? ' is-weapons' : ''}`}>
    {[first, ...refs.filter((ref) => ref.id !== first.id)].map((ref) => cell(ref, ref.id === first.id))}
  </ul>
}

/**
 * The example of a choice and «или любое из N» (`more`, «+N» in the card at rest); pointing at it lists every allowed
 * variant (owner, 16.10.2026: «при наведении курсора на один из вариантов, появляется всплывающее окно со всеми
 * допустимыми. так же с оружием, прицелами и модулями»). A single fixed thing is shown as it is: no list, no «или».
 */
function Choice({ options, sets = false, weapons, example, pictures, more, as, className, toggle, children }: {
  options: ItemRef[][]
  sets?: boolean
  weapons?: boolean
  example?: ItemRef
  pictures: Pictures
  /** Instead of «или любое из N»: «+N» at rest. */
  more?: string
  as?: 'span' | 'div'
  className?: string
  /** In the dialog: «или любое из N» is a button (ChoicePopover). */
  toggle?: boolean
  children: ReactNode
}) {
  const total = variantCount(options, sets)
  if (total <= 1) {
    return as === 'div' ? <div className={className}>{children}</div> : <span className={className}>{children}</span>
  }
  return <ChoicePopover as={as} className={className} toggle={toggle}
    more={more ?? uiText(sets ? `или другой вариант из ${total}` : `или любое из ${total}`)}
    heading={uiText(sets ? `Подходит любой вариант из ${total}` : `Подходит любое из ${total}`)}
    content={<VariantList options={options} sets={sets} weapons={weapons} example={example} pictures={pictures} />}>
    {children}
  </ChoicePopover>
}

/** The quest's weapons as a choice: one option per weapon. */
function weaponOptions(conditions: ObjectiveConditions): ItemRef[][] {
  return distinct(conditions.weapons ?? []).map((ref) => [ref])
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
 * Parts or gear at rest: the first few icons of the items to take (shortOptions) and «+N»; pointing at a choice lists
 * every variant.
 */
function RestOptions({ kind, options, pictures }: { kind: string; options: ItemRef[][]; pictures: Pictures }) {
  const short = shortOptions(options, pictures)
  const shown = short.refs.slice(0, CARD_PARTS)
  const hidden = short.refs.length - shown.length
  const icons = shown.map((ref) => <ItemIcon key={ref.id} item={ref} pictures={pictures} />)
  const className = `qc-icon-group is-${kind}`
  if (short.total > 1) {
    return <Choice className={className} options={options} sets={short.sets} example={short.refs[0]} pictures={pictures}
      more={`+${hidden + short.total - 1}`}>{icons}</Choice>
  }
  return <span className={className}>{icons}{hidden > 0 && <span className="qc-more">+{hidden}</span>}</span>
}

/**
 * The pictures of one objective at rest: one row of equal tiles — the weapon in a wide one, then the first few parts
 * and gear — that wraps as a whole; «+N» is always the badge in the corner of its group's last tile (owner, 17.10.2026:
 * «сделай все опрятно, аккуратно, чтобы не в разнобой»; questConditions.css). Gear not to wear is never shown (owner,
 * 15.10.2026: «то что не нужно надевать, не показывай»).
 */
export function GearStrip({ conditions, pictures }: { conditions: ObjectiveConditions; pictures: Pictures }) {
  const weapons = weaponOptions(conditions)
  const weapon = weapons.length ? exampleOf(weapons.flat(), pictures) : undefined
  const mods = conditions.mods?.length ? conditions.mods : undefined
  const wearing = conditions.wearing?.length ? conditions.wearing : undefined
  return <span className={`qc-gear${weapon ? ' has-weapon' : ''}`}>
    {weapon && <Choice className="qc-weapon-group" options={weapons} weapons example={weapon} pictures={pictures} more={`+${weapons.length - 1}`}>
      <Picture className="qc-weapon" src={weaponPictureOf(weapon.id, pictures)} alt={uiText(nameOf(weapon, pictures))} fallback={<Crosshair size={20} />} />
    </Choice>}
    {(mods || wearing) && <span className="qc-reqs">
      {mods && <RestOptions kind="mods" options={mods} pictures={pictures} />}
      {wearing && <RestOptions kind="wearing" options={wearing} pictures={pictures} />}
    </span>}
  </span>
}

/** Parts or gear in the unfolded card, shortly (shortOptions). */
function FullOptions({ kind, title, options, pictures }: { kind: string; title: string; options: ItemRef[][]; pictures: Pictures }) {
  const short = shortOptions(options, pictures)
  return <span className={`qc-full-row is-${kind}`}>
    <span className="qc-full-label">{uiText(title)}</span>
    <Choice className="qc-full-items" options={options} sets={short.sets} example={short.refs[0]} pictures={pictures}>
      {short.refs.map((ref) => <ItemIcon key={ref.id} item={ref} pictures={pictures} />)}
    </Choice>
  </span>
}

/**
 * One objective unfolded: a row per kind of picture (weapon, parts, gear) with its label above and «или любое из N»
 * below the same tiles as at rest (one example of a choice; pointing at it lists them all), every condition and map.
 */
function FullObjective({ objective, pictures, mapName }: { objective: QuestObjective; pictures: Pictures; mapName: (id: string) => string }) {
  const conditions = objective.conditions ?? {}
  const pieces = allConditionPieces(objective)
  const weapons = weaponOptions(conditions)
  const weapon = weapons.length ? exampleOf(weapons.flat(), pictures) : undefined
  const reqs = Boolean(conditions.mods?.length || conditions.wearing?.length)
  return <span className="qc-full-objective">
    {(weapon || reqs) && <span className={`qc-full-build${weapon ? ' has-weapon' : ''}`}>
      {weapon && <span className="qc-full-row is-weapons">
        <span className="qc-full-label">{uiText('Оружие')}</span>
        <Choice className="qc-full-items" options={weapons} weapons example={weapon} pictures={pictures}>
          <Picture className="qc-weapon" src={weaponPictureOf(weapon.id, pictures)} alt={uiText(nameOf(weapon, pictures))} fallback={<Crosshair size={20} />} />
        </Choice>
      </span>}
      {reqs && <span className="qc-full-reqs">
        {conditions.mods?.length ? <FullOptions kind="mods" title="Модули на оружии" options={conditions.mods} pictures={pictures} /> : null}
        {conditions.wearing?.length ? <FullOptions kind="wearing" title="Надеть" options={conditions.wearing} pictures={pictures} /> : null}
      </span>}
    </span>}
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
    // A press in the list of a choice's variants (in <body>) is a press on the card.
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || (target instanceof Element && target.closest(`.${CHOICE_POPUP_CLASS}`))) return
      close()
    }
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

  return <div ref={rootRef} className={`stat-card quest-conditions-card${open ? ' is-listing' : ''}${shown ? '' : ' is-empty'}`} onPointerEnter={hoverOpen} onPointerLeave={hoverClose}>
    <div className="qc-head">
      <div className="stat-label">{label}</div>
      {others.length > 0 && <button type="button" className="qc-count" aria-expanded={open} aria-controls={popId} onClick={() => open && pinned.current ? fold() : unfold()}>
        {uiText(`ещё ${others.length}`)}<ChevronDown size={12} aria-hidden="true" />
      </button>}
    </div>
    {shown
      ? <QuestCard entry={shown} pictures={pictures} mapName={mapName} onOpen={() => openDetails(shown)} />
      : <>
        <p className="qc-empty">{uiText('На этой карте нет квестов с условиями на снаряжение')}</p>
        {/* Nothing to gather: the Goons rest inside the empty block, leaning on its sides; Big Pipe's grenade launcher
            stands beside him (owner, 16.10.2026: «если этот блок пустой и нету квестов, то там сидят кочевники»). */}
        <div className="qc-goons" aria-hidden="true">
          <img className="qc-goon is-left" src={bigPipeResting} alt="" draggable={false} />
          <img className="qc-goon is-right" src={birdeyeResting} alt="" draggable={false} />
        </div>
      </>}
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
    <Choice as="div" toggle className="qc-choice-block" options={options} sets={short.sets} example={short.refs[0]} pictures={pictures}>
      <div className="gs-parts">{short.refs.map((ref) => <ItemCard key={ref.id} item={ref} pictures={pictures} />)}</div>
    </Choice>
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
    {objectives.map((objective, index) => {
      const conditions = objective.conditions ?? {}
      const here = objectiveOnMap(objective, mapId)
      const weapons = weaponOptions(conditions)
      const weapon = weapons.length ? exampleOf(weapons.flat(), pictures) : undefined
      return <article key={`${index}:${objective.id}`} className={`qc-objective${here ? ' is-here' : ''}`}>
        {texts && objective.description && <p className="qc-objective-text">{uiText(objective.description)}</p>}
        {weapon ? <div className="gs-block qc-block">
          <h5>{uiText('Оружие')}</h5>
          <Choice as="div" toggle className="qc-choice-block" options={weapons} weapons example={weapon} pictures={pictures}>
            <div className="qc-weapons is-single"><WeaponCard weapon={weapon} pictures={pictures} /></div>
          </Choice>
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
