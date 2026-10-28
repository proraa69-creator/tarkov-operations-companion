import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, ChevronDown, Map as MapIcon, Target, X } from 'lucide-react'
import type { Item, MapMarker, ModeProgress, Quest } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { sheetObjectives } from '../progression/sheetObjectives'

/**
 * Phone «Карты» (owner, 17.10.2026): the location list is a button where the map's name was, opening every map in
 * several rows; «Квесты» at the bottom left lists the current quests of the map — a tap closes the list and opens the
 * quest's window, a held finger shows its objectives and requirements in short.
 */

/** Closes a panel on a tap outside of it (and on Escape). */
function useDismiss(open: boolean, close: () => void, ref: { current: HTMLElement | null }) {
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) close() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', key) }
  }, [close, open, ref])
}

export function PhoneMapPicker({ maps, activeId, onPick }: { maps: Array<{ id: string; name: string; accent?: string }>; activeId: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)
  useDismiss(open, close, ref)
  const active = maps.find((map) => map.id === activeId)
  return <div className={`phone-map-picker${open ? ' is-open' : ''}`} ref={ref}>
    <button type="button" className="phone-map-chip" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <MapIcon size={15} />
      <span className="phone-map-chip-name">{uiText(active?.name ?? 'Карты')}</span>
      <ChevronDown size={14} className="phone-map-chip-chevron" />
    </button>
    <div className="phone-map-panel phone-map-list" role="listbox" aria-label={uiText('Карты')} inert={!open}>
      {maps.map((map) => <button type="button" role="option" aria-selected={map.id === activeId} key={map.id} className={`phone-map-option${map.id === activeId ? ' active' : ''}`} onClick={() => { close(); onPick(map.id) }}>
        <span className="map-color" style={{ background: map.accent }} />
        <span>{uiText(map.name)}</span>
      </button>)}
    </div>
  </div>
}

export interface PhoneQuestEntry { quest: Quest; marker?: MapMarker }

const HOLD_MS = 450
const MOVE_TOLERANCE = 10

/** A tap or a held finger on one row; a scroll cancels both. */
function useHold(onTap: () => void, onHold: () => void) {
  const timer = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const held = useRef(false)
  const cancel = () => { window.clearTimeout(timer.current); start.current = null }
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      held.current = false
      start.current = { x: event.clientX, y: event.clientY }
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { held.current = true; start.current = null; onHold() }, HOLD_MS)
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > MOVE_TOLERANCE) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
    onClick: () => { if (held.current) { held.current = false; return } onTap() },
  }
}

function QuestRow({ entry, onOpen, onPeek }: { entry: PhoneQuestEntry; onOpen: () => void; onPeek: () => void }) {
  const hold = useHold(onOpen, onPeek)
  const { quest } = entry
  return <button type="button" className="phone-quest-row" {...hold}>
    <strong>{uiText(quest.name)}</strong>
    <small>{uiText(`${quest.trader}${quest.anyMap ? ' · любая карта' : ` · ур. ${quest.level}`}${quest.kappa ? ' · капа' : ''}`)}</small>
  </button>
}

const PEEK_LINES = 6

/** The short card of a held quest: what to do and what it needs. */
function QuestPeek({ quest, mapId, maps, itemsById, progress, onClose, onOpen }: {
  quest: Quest; mapId: string; maps: Array<{ id: string; name: string }>; itemsById: Map<string, Item>; progress: ModeProgress; onClose: () => void; onOpen: () => void
}) {
  const sheet = sheetObjectives(quest, { mapId, maps, itemsById, progress })
  const goals = sheet
    ? sheet.groups.filter((group) => group.kind !== 'handover').flatMap((group) => group.objectives.map((objective) => ({ text: objective.text, done: objective.done, count: objective.count })))
    : quest.objectives.map((text) => ({ text, done: false, count: undefined }))
  const handover = sheet?.groups.find((group) => group.kind === 'handover')?.objectives ?? []
  const items = (quest.requiredItems ?? []).map((id) => itemsById.get(id)?.name).filter((name): name is string => Boolean(name))
  const needs = [
    `Уровень ${quest.level}+`,
    ...handover.map((objective) => `${objective.item ?? objective.text}${objective.count ? ` ×${objective.count}` : ''}${objective.foundInRaid ? ' (FIR)' : ''}`),
    ...items.filter((name) => !handover.some((objective) => objective.item === name)),
  ]
  return <div className="phone-quest-peek-backdrop" onClick={onClose}>
    <div className="phone-quest-peek" role="dialog" aria-modal="true" aria-label={uiText(quest.name)} onClick={(event) => event.stopPropagation()}>
      <button type="button" className="phone-quest-peek-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={15} /></button>
      <div className="phone-quest-peek-eyebrow">{uiText(quest.trader)}</div>
      <h3>{uiText(quest.name)}</h3>
      <h4>{uiText('Цели')}</h4>
      <ul>
        {goals.slice(0, PEEK_LINES).map((goal, index) => <li key={index} className={goal.done ? 'is-done' : undefined}>{goal.done && <Check size={12} />}{uiText(goal.text)}{goal.count ? ` ×${goal.count}` : ''}</li>)}
        {goals.length > PEEK_LINES && <li className="dim">{uiText(`и ещё ${goals.length - PEEK_LINES}`)}</li>}
      </ul>
      <h4>{uiText('Требования')}</h4>
      <ul>{needs.slice(0, PEEK_LINES).map((need, index) => <li key={index}>{uiText(need)}</li>)}</ul>
      <button type="button" className="button small primary phone-quest-peek-open" onClick={onOpen}>{uiText('Открыть квест')}</button>
    </div>
  </div>
}

export function PhoneMapQuests({ entries, mapId, maps, itemsById, progress, hidden, onOpen }: {
  entries: PhoneQuestEntry[]
  mapId: string
  maps: Array<{ id: string; name: string }>
  itemsById: Map<string, Item>
  progress: ModeProgress
  /** The quest window is open over the bottom of the map. */
  hidden: boolean
  onOpen: (entry: PhoneQuestEntry) => void
}) {
  const [open, setOpen] = useState(false)
  const [peek, setPeek] = useState<PhoneQuestEntry | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)
  useDismiss(open && !peek, close, ref)
  // A quest picked from the list opens its window; closing that window (✕) brings the list back to pick the next one
  // (owner, 28.10.2026: «нажимаю перекрестие, и у меня должно опять открыться окно с квестами»).
  const reopen = useRef(false)
  const choose = (entry: PhoneQuestEntry) => { setPeek(null); setOpen(false); reopen.current = true; onOpen(entry) }
  const wasHidden = useRef(hidden)
  useEffect(() => {
    if (wasHidden.current && !hidden && reopen.current) setOpen(true)
    if (wasHidden.current && !hidden) reopen.current = false
    wasHidden.current = hidden
  }, [hidden])
  if (hidden) return null
  return <>
    <div className={`phone-map-quests${open ? ' is-open' : ''}`} ref={ref}>
      <div className="phone-map-panel phone-quest-list" inert={!open}>
        {entries.length
          ? entries.map((entry) => <QuestRow key={entry.quest.id} entry={entry} onOpen={() => choose(entry)} onPeek={() => setPeek(entry)} />)
          : <p className="dim phone-quest-empty">{uiText('На этой карте нет текущих квестов.')}</p>}
        {entries.length > 0 && <p className="phone-quest-hint">{uiText('Удерживайте квест — коротко цели и требования.')}</p>}
      </div>
      <button type="button" className="phone-map-chip phone-quests-chip" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Target size={15} />
        <span>{uiText('Квесты')}</span>
        <span className="phone-quests-count">{entries.length}</span>
      </button>
    </div>
    {peek && <QuestPeek quest={peek.quest} mapId={mapId} maps={maps} itemsById={itemsById} progress={progress} onClose={() => setPeek(null)} onOpen={() => choose(peek)} />}
  </>
}
