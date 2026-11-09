import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { Polygon } from 'react-leaflet'
import { Check, ChevronDown, Clock, Crosshair, Map as MapIcon, MapPin, Ruler, Shirt, Skull, Target, Wrench, X, Zap, type LucideIcon } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { killZoneStyle, type KillRow, type KillSummary, type KillTag, type KillTagKind, type KillZone } from '../maps/killObjectives'
import { useMapDragged } from '../maps/mapDragGuard'
import './mapKills.css'

/**
 * «Устранения» on the map (owner, 08.11.2026; maps/killObjectives.ts). On the PC a tab of the right panel beside «Актуальные
 * квесты» (owner: «справа, где актуальные квесты, и там будет вот кнопка актуальные квесты и устранение»); on the phone a button
 * in the HUD with a small window under it. Both list every kill of the current quests on this map, with the short count of what is
 * left, and the switch of the zones they are done in («Места устранения»).
 */
export function MapKillsButton({ count, open, onToggle, buttonRef }: { count: number; open: boolean; onToggle: () => void; buttonRef?: RefObject<HTMLButtonElement | null> }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`map-tool map-kills-button${open ? ' active' : ''}${count ? ' has-kills' : ''}`}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={count ? `${uiText('Устранения')}: ${count}` : uiText('Устранения')}
      title={uiText('Квесты на устранение на этой карте')}
      onClick={onToggle}
    >
      <Skull size={14} aria-hidden="true" />
      <span>{uiText('Устранения')}</span>
      {count > 0 && <b className="map-kills-count" aria-hidden="true">{count}</b>}
    </button>
  )
}

export type MapDetailTab = 'quests' | 'kills'

/** The PC's right panel: «Актуальные квесты» (quests with points on this map) and «Устранения», each with its count. */
export function MapDetailTabs({ tab, onTab, quests, kills }: { tab: MapDetailTab; onTab: (tab: MapDetailTab) => void; quests: number; kills: number }) {
  // «Устранения» is gone from here (owner, 10.11.2026: «в блоке справа убери места устранения»); `kills` stays for the callers.
  void kills
  const tabs: Array<[MapDetailTab, string, number]> = [['quests', 'Актуальные квесты', quests]]
  return (
    <div className="map-detail-tabs" role="tablist" aria-label={uiText('Квесты на карте')}>
      {tabs.map(([id, label, count]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className={`map-detail-tab${tab === id ? ' active' : ''}`} onClick={() => onTab(id)}>
          <span>{uiText(label)}</span>
          <small>{count}</small>
        </button>
      ))}
    </div>
  )
}

const TAG_ICONS: Record<KillTagKind, LucideIcon> = {
  weapon: Crosshair, mods: Wrench, gear: Shirt, part: Target, distance: Ruler, hit: Target, time: Clock, zone: MapPin, enemy: Zap, player: Zap, maps: MapIcon,
}

/** What each tag is, for its tooltip (the words of «Сбор на рейд», src/i18n/uiEnglishQuestConditions.ts). */
const TAG_TITLES: Record<KillTagKind, string> = {
  weapon: 'Оружие', mods: 'Модули на оружии', gear: 'Надеть', part: 'Части тела', distance: 'Дистанция', hit: 'Попасть', time: 'Время в игре',
  zone: 'только в зонах задания', enemy: 'Цель под эффектом', player: 'Вы под эффектом', maps: 'Карты',
}

/** The conditions of a kill as short tags, each with what it is (and every item a choice allows) on hover. */
function KillTags({ tags }: { tags: readonly KillTag[] }) {
  return <>
    {tags.map((tag, index) => {
      const Icon = TAG_ICONS[tag.kind]
      const detail = tag.names?.length ? tag.names.map((name) => uiText(name)).join(', ') : uiText(tag.text)
      return <span key={`${tag.kind}:${index}`} className={`map-kills-tag is-${tag.kind}`} title={`${uiText(TAG_TITLES[tag.kind])}: ${detail}`}><Icon size={11} aria-hidden="true" />{uiText(tag.text)}</span>
    })}
  </>
}

const TOTALS: Array<[keyof KillSummary, string]> = [['scav', 'Дикие'], ['pmc', 'ЧВК'], ['other', 'Другие']]

/**
 * The short count (owner: «Краткая информация: уничтожить там общее число диких, общее число ЧВК») and the tick «Места
 * устранения» with the zones' colours.
 */
function KillsHeader({ summary, zoneCount, zonesShown, onZones, onClose, bothZones = false }: { summary: KillSummary; zoneCount: number; zonesShown: boolean; onZones: (shown: boolean) => void; onClose?: () => void; bothZones?: boolean }) {
  const any = TOTALS.some(([kind]) => summary[kind] > 0)
  return <>
    <div className="map-kills-head">
      <span className="map-kills-summary" aria-label={uiText('Осталось устранить')}>
        <span className="map-kills-label">{uiText('Всего')}</span>
        {TOTALS.filter(([kind]) => summary[kind] > 0).map(([kind, label]) => (
          <span key={kind} className={`map-kills-total is-${kind}`}><i aria-hidden="true" />{uiText(label)}<b>{summary[kind]}</b></span>
        ))}
        {!any && <span className="map-kills-total">{uiText('всё выполнено')}</span>}
      </span>
      {onClose && <button type="button" className="map-kills-close" aria-label={uiText('Закрыть')} title={uiText('Закрыть')} onClick={onClose}><X size={14} aria-hidden="true" /></button>}
    </div>
    <div className="map-kills-zones">
      <label>
        <input type="checkbox" checked={zonesShown} onChange={(event) => onZones(event.target.checked)} />
        <span>{uiText('Места устранения')}</span>
      </label>
      {zoneCount > 0 ? (
        <span className="map-kills-legend" aria-hidden="true">
          <span className="is-scav"><i />{uiText('Дикие и др.')}</span>
          <span className="is-pmc"><i />{uiText('ЧВК')}</span>
          {bothZones && <span className="is-both"><i />{uiText('ЧВК + дикие')}</span>}
        </span>
      ) : <small>{uiText('Зон на этой карте нет')}</small>}
    </div>
  </>
}

/**
 * The row's text runs past its width (the quest's name or the line of conditions): a press unfolds it. Measured folded only:
 * unfolded, the text fits by wrapping.
 */
function useCut(ref: RefObject<HTMLElement | null>, unfolded: boolean) {
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const row = ref.current
    if (!row || unfolded) return
    const measure = () => setCut([...row.querySelectorAll<HTMLElement>('.map-kills-quest, .map-kills-line')].some((node) => node.scrollWidth > node.clientWidth + 1))
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(row)
    return () => observer?.disconnect()
  }, [ref, unfolded])
  return cut
}

/**
 * One kill: how many are left (of how many), the quest's name and what to do — the target and its conditions in short tags, in a
 * small font (owner: «Короткая, маленький шрифт, название квеста, что нужно сделать»). A row cut short unfolds a little on the press
 * that opens its quest; one that fits stays as it is (owner: «Если влезает, то не надо раскладывать»).
 */
function KillRowButton({ row, selected, expanded, onPress, onMenu }: { row: KillRow; selected: boolean; expanded: boolean; onPress: () => void; onMenu?: (event: ReactMouseEvent) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const cut = useCut(ref, expanded)
  // picked on the map (its zone): the row comes into view (report №98)
  useEffect(() => { if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' }) }, [selected])
  const open = expanded && cut
  return (
    <button
      ref={ref}
      type="button"
      className={`map-kills-row is-${row.kind}${row.settled ? ' is-settled' : ''}${selected ? ' is-selected' : ''}${open ? ' is-expanded' : ''}${cut ? ' is-cut' : ''}`}
      title={uiText(row.objective.description)}
      aria-expanded={cut ? open : undefined}
      onClick={onPress}
      onContextMenu={onMenu}
    >
      <span className="map-kills-left">
        {row.left === 0 ? <Check size={15} strokeWidth={3} aria-label={uiText('Выполнено')} /> : <b>{row.left}</b>}
        {row.left > 0 && row.current > 0 && <small>{uiText(`из ${row.total}`)}</small>}
      </span>
      <span className="map-kills-copy">
        <span className="map-kills-quest">{uiText(row.quest.name)}</span>
        <span className="map-kills-line">
          <strong className="map-kills-target">{uiText(row.target)}</strong>
          <KillTags tags={row.tags} />
        </span>
      </span>
      {cut && <ChevronDown className="map-kills-more" size={13} aria-hidden="true" />}
    </button>
  )
}

interface KillListProps {
  rows: readonly KillRow[]
  /** A row: its quest opens as from «Квесты на карте». */
  onOpen: (row: KillRow) => void
  /** The PC's right click on a row (the quest's menu: «Отложить квест»…). */
  onMenu?: (row: KillRow) => ((event: ReactMouseEvent) => void) | undefined
  selectedQuestId?: string
}

function KillList({ rows, onOpen, onMenu, selectedQuestId }: KillListProps) {
  // The row pressed last unfolds while its quest stays open; another quest picked anywhere folds it.
  const [pressed, setPressed] = useState<string | null>(null)
  return (
    <ul className="map-kills-list">
      {rows.map((row) => {
        const selected = selectedQuestId === row.quest.id
        return (
          <li key={row.key}>
            <KillRowButton
              row={row}
              selected={selected}
              expanded={selected && pressed === row.key}
              onPress={() => { setPressed((current) => (current === row.key && selected ? null : row.key)); onOpen(row) }}
              onMenu={onMenu?.(row)}
            />
          </li>
        )
      })}
    </ul>
  )
}

export interface MapKillsContentProps extends KillListProps {
  summary: KillSummary
  /** The zones drawn on this map now (0: none here). */
  zoneCount: number
  /** A place where PMCs and Scavs are both to be killed is drawn (blue): the legend names it. */
  bothZones?: boolean
  zonesShown: boolean
  onZones: (shown: boolean) => void
}

/** The PC: «Устранения» in the right panel, under its tab. */
export function MapKillsPanel({ rows, summary, zoneCount, bothZones = false, zonesShown, onZones, onOpen, onMenu, selectedQuestId }: MapKillsContentProps) {
  return (
    <div className="map-kills-panel" role="tabpanel" aria-label={uiText('Устранения')}>
      <KillsHeader summary={summary} zoneCount={zoneCount} bothZones={bothZones} zonesShown={zonesShown} onZones={onZones} />
      {rows.length
        ? <KillList rows={rows} onOpen={onOpen} onMenu={onMenu} selectedQuestId={selectedQuestId} />
        : <p className="map-kills-empty">{uiText('На этой карте нет квестов на устранение.')}</p>}
    </div>
  )
}

interface Placement { top: number; maxHeight: number }

/**
 * The phone: under the HUD, across the map and never over half of it (owner: «не на пол карты, чтобы не закрывала карту, а было
 * сверху… можно будет листать»). The list scrolls.
 */
function useWindowPlacement(anchorRef: RefObject<HTMLElement | null>, rowsKey: string) {
  const [place, setPlace] = useState<Placement | null>(null)
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const stage = anchor?.closest<HTMLElement>('.map-stage')
    if (!anchor || !stage) return
    const update = () => {
      const button = anchor.getBoundingClientRect()
      const box = stage.getBoundingClientRect()
      const hud = stage.querySelector('.map-hud')?.getBoundingClientRect()
      const top = Math.round(Math.max(button.bottom, hud?.bottom ?? 0) - box.top + 6)
      const room = box.height - top - 12
      setPlace({ top, maxHeight: Math.max(150, Math.round(Math.min(340, room * 0.6))) })
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(stage)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [anchorRef, rowsKey])
  return place
}

export interface MapKillsWindowProps extends MapKillsContentProps {
  anchorRef: RefObject<HTMLElement | null>
  /** Must keep its identity between renders. */
  onClose: () => void
}

/** The phone: the window under «Устранения» in the HUD; Escape, the ✕ or a press outside closes it. */
export function MapKillsWindow({ rows, summary, zoneCount, bothZones = false, zonesShown, onZones, onOpen, onMenu, selectedQuestId, anchorRef, onClose }: MapKillsWindowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const place = useWindowPlacement(anchorRef, `${rows.length}`)
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    // Escape closes the window, not the map's full screen under it.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onClose])
  return (
    <div
      ref={ref}
      className="map-kills-window"
      role="dialog"
      aria-label={uiText('Устранения')}
      style={place ? { top: place.top, maxHeight: place.maxHeight } : { visibility: 'hidden' }}
    >
      <KillsHeader summary={summary} zoneCount={zoneCount} bothZones={bothZones} zonesShown={zonesShown} onZones={onZones} onClose={onClose} />
      <KillList rows={rows} onOpen={onOpen} onMenu={onMenu} selectedQuestId={selectedQuestId} />
    </div>
  )
}

/**
 * The zones on the map, under the points. A press on one opens its quest (report №98, 08.11.2026: «что бы выделенные места
 * устранения не показывало какой квест сразу а что бы надо было нажать по области»; owner: «тебя автоматически перекидывает во
 * вкладку устранения. Выделяется справа этот квест… и открывается снизу блок с квестом. А когда наводишь мышку на эту зону, окно
 * не появляется»): no window on hover, the chosen zone brighter in its own colour. The press stays with the zone (the map does not
 * close the quest it opens); a press that dragged the map opens nothing.
 */
export function MapKillZones({ zones, focusedQuestId, onPick }: { zones: readonly KillZone[]; focusedQuestId?: string | null; onPick?: (zone: KillZone) => void }) {
  const dragged = useMapDragged()
  return <>
    {zones.map((zone) => (
      <Polygon
        key={zone.key}
        positions={zone.positions}
        pathOptions={{ ...killZoneStyle(zone.kind, Boolean(focusedQuestId && zone.questIds.includes(focusedQuestId))), className: 'map-kill-zone', bubblingMouseEvents: false }}
        eventHandlers={{ click: () => { if (!dragged.current) onPick?.(zone) } }}
      />
    ))}
  </>
}

/** «Места устранения» in «Точки на карте»: the same switch as the tick in «Устранения». */
export function KillZonesLayerButton({ count, shown, onToggle }: { count: number; shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`layer-button map-kills-layer${shown ? ' active' : ''}`} aria-pressed={shown} onClick={onToggle}>
      <span className="map-kills-layer-icon" aria-hidden="true"><i className="is-scav" /><i className="is-pmc" /></span>
      <span>{uiText('Места устранения')}</span>
      <small>{count}</small>
    </button>
  )
}
