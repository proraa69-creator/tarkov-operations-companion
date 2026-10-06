/* eslint-disable react-refresh/only-export-components */
import { uiText } from '../i18n/renderText'
import { useCallback, useMemo, useState } from 'react'
import { CircleMarker, Tooltip, useMapEvents } from 'react-leaflet'
import { Crosshair, EyeOff, LoaderCircle, MapPinPlus, PencilRuler, RotateCcw, Search, X } from 'lucide-react'
import { isOwnerApp } from '../app/buildEdition'
import { cleanIpcError } from '../sync/serverSync'
import { addedOverrideIdOf, useQuestPointOverrides, useQuestPointWriter, type QuestPointInput, type QuestPointOverride } from '../data/questPointOverrides'
import type { GameMap, MapMarker, Quest } from '../domain/types'

/**
 * «Квесты: правка точек» (owner app only, server/src/routes/questPoints.ts): find a quest by name, pick its objective /
 * story stage, drag a wrong point to the right place, click the map to add a point, hide a wrong one or return the
 * original. Every change is saved at once and every player's map shows it (src/data/questPointOverrides.ts).
 * The floor selected on the map goes with a moved / added point when it is not the main level.
 */
export function useQuestPointEditor({ mapId, floor, baseFloor, quests, markers }: { mapId: string; floor: string; baseFloor: string; quests: Quest[]; markers: MapMarker[] }) {
  const enabled = isOwnerApp()
  const overrides = useQuestPointOverrides(enabled)
  const writer = useQuestPointWriter()
  const [active, setActive] = useState(false)
  const [questId, setQuestId] = useState('')
  /** '' = all points; `o:<objective id>`; `s:<stage index>`. */
  const [goal, setGoal] = useState('')
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const quest = questId ? quests.find((entry) => entry.id === questId) : undefined
  const byMarker = useMemo(() => new Map(overrides.filter((entry) => entry.kind !== 'add' && entry.markerId).map((entry) => [entry.markerId!, entry])), [overrides])
  /** Plotted points of every quest: questId → mapId → count (search results and «other maps»). */
  const pointCounts = useMemo(() => {
    const counts = new Map<string, Map<string, number>>()
    for (const marker of markers) {
      if (!marker.questId || !isQuestPoint(marker)) continue
      const perMap = counts.get(marker.questId) ?? new Map<string, number>()
      perMap.set(marker.mapId, (perMap.get(marker.mapId) ?? 0) + 1)
      counts.set(marker.questId, perMap)
    }
    return counts
  }, [markers])
  const goalMatches = useCallback((entry: { objectiveId?: string; stageIndex?: number }) => !goal
    || (goal.startsWith('o:') && entry.objectiveId === goal.slice(2))
    || (goal.startsWith('s:') && entry.stageIndex === Number(goal.slice(2))), [goal])
  /** The edited quest's points on this map (of the chosen objective / stage). */
  const points = useMemo(() => (active && questId ? markers.filter((marker) => marker.questId === questId && marker.mapId === mapId && isQuestPoint(marker) && goalMatches(marker)) : []),
    [active, questId, markers, mapId, goalMatches])
  /** Hidden points of the quest on this map: drawn greyed out, a click returns them. */
  const hidden = useMemo(() => (active && questId ? overrides.filter((entry) => entry.kind === 'hide' && entry.questId === questId && entry.mapId === mapId && goalMatches(entry)) : []),
    [active, questId, overrides, mapId, goalMatches])

  /** True when the server accepted the change. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action(); return true } catch (reason) { setError(ownerError(reason)); return false } finally { setBusy(false) }
  }
  const floorField = () => (floor !== baseFloor ? { floor } : {})
  const noteField = () => (note.trim() ? { note: note.trim().slice(0, 300) } : {})
  const goalField = (marker?: MapMarker) => {
    if (marker) return { ...(marker.objectiveId ? { objectiveId: marker.objectiveId } : {}), ...(marker.stageIndex != null ? { stageIndex: marker.stageIndex } : {}) }
    if (goal.startsWith('o:')) return { objectiveId: goal.slice(2) }
    if (goal.startsWith('s:')) return { stageIndex: Number(goal.slice(2)) }
    return {}
  }
  const addedOverride = (marker: MapMarker) => {
    const id = addedOverrideIdOf(marker)
    return id ? overrides.find((entry) => entry.id === id) : undefined
  }

  /** Drag and drop: saved at once. An added point keeps its id; a catalog point gets (or updates) its «move». */
  const move = (marker: MapMarker, x: number, z: number) => run(async () => {
    if (!marker.questId) return
    const added = addedOverride(marker)
    const input: QuestPointInput = added
      ? { ...stripMeta(added), x: round(x), z: round(z), ...floorField(), ...noteField() }
      : { questId: marker.questId, markerId: marker.id, mapId: marker.mapId, x: round(x), z: round(z), kind: 'move', ...goalField(marker), ...floorField(), ...noteField() }
    if (added && floor === baseFloor) delete input.floor
    await writer.save(input)
  })
  /** «Добавить точку»: a click on the map while adding. */
  const add = (x: number, z: number) => run(async () => {
    if (!questId) throw new Error('Сначала выберите квест.')
    await writer.save({ questId, mapId, x: round(x), z: round(z), kind: 'add', ...goalField(), ...floorField(), ...noteField() })
  })
  /** «Скрыть»: a catalog point is hidden (where it stood is kept); an added point is simply deleted. */
  const hide = (marker: MapMarker) => run(async () => {
    if (!marker.questId) return
    const addedId = addedOverrideIdOf(marker)
    if (addedId) { await writer.reset(addedId); return }
    await writer.save({ questId: marker.questId, markerId: marker.id, mapId: marker.mapId, x: round(marker.position[1]), z: round(marker.position[0]), kind: 'hide', ...goalField(marker), ...(marker.floor && marker.floor !== baseFloor ? { floor: marker.floor } : {}), ...noteField() })
  })
  /** «Вернуть исходную»: the correction is removed (an added point disappears). */
  const reset = (overrideId: string) => run(() => writer.reset(overrideId))
  /** The correction behind a point drawn on the map, if any. */
  const overrideOf = (marker: MapMarker): QuestPointOverride | undefined => addedOverride(marker) ?? byMarker.get(marker.id)
  /** A marker on the map that the owner can drag right now. */
  const canDrag = (marker: MapMarker) => active && !busy && Boolean(questId) && marker.questId === questId && isQuestPoint(marker)
  const pick = (id: string) => { setQuestId(id); setGoal(''); setAdding(false); setError('') }

  return {
    enabled, active: enabled && active, setActive: (value: boolean) => { setActive(value); if (!value) setAdding(false) },
    questId, quest, pick, goal, setGoal, adding: enabled && active && adding && Boolean(questId), setAdding, note, setNote,
    busy, error, points, hidden, pointCounts, overrides, move, add, hide, reset, overrideOf, canDrag, mapId, floor, baseFloor,
    /** While a quest is being edited, the map shows only its points (all of them, on every floor). */
    editingQuest: enabled && active && questId ? questId : '',
    shows: goalMatches,
  }
}

export type QuestPointEditorState = ReturnType<typeof useQuestPointEditor>

const QUEST_SOURCES_EXCLUDED = new Set(['quest-fallback', 'quest-any-map', 'quest-info'])
const isQuestPoint = (marker: MapMarker) => (marker.type === 'quest' || marker.layerId === 'quest.zone' || marker.layerId === 'quest.item') && !QUEST_SOURCES_EXCLUDED.has(marker.source ?? '')
const round = (value: number) => Math.round(value * 10) / 10
function stripMeta(entry: QuestPointOverride): QuestPointInput {
  const input: QuestPointInput & Partial<Pick<QuestPointOverride, 'updatedAt' | 'updatedBy'>> = { ...entry }
  delete input.updatedAt
  delete input.updatedBy
  delete input.note
  return input
}
const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()

function ownerError(reason: unknown) {
  const message = cleanIpcError(reason)
  if (/Не найдено|Неизвестный запрос/.test(message)) return 'Править точки квестов может только аккаунт владельца.'
  if (/Требуется вход|Сессия истекла/.test(message)) return 'Войдите в аккаунт владельца на сервере.'
  return message || 'Сервер недоступен'
}

/** Quests whose name (RU or EN slug) or id contains the text; quests with points on this map first. */
export function searchQuests(quests: Quest[], text: string, mapId: string, counts: Map<string, Map<string, number>>, limit = 12): Quest[] {
  const query = normalize(text)
  if (query.length < 2) return []
  const here = (quest: Quest) => (counts.get(quest.id)?.get(mapId) ?? 0) > 0
  return quests
    .filter((quest) => normalize(quest.name).includes(query) || normalize(quest.normalizedName ?? '').includes(query) || quest.id.toLowerCase() === query)
    .sort((a, b) => Number(here(b)) - Number(here(a)) || Number(normalize(b.name).startsWith(query)) - Number(normalize(a.name).startsWith(query)) || a.name.localeCompare(b.name, 'ru'))
    .slice(0, limit)
}

/** Objectives (trader quest) or stages (story chapter) to pick from. */
export function questGoals(quest: Quest, markers: MapMarker[]): Array<{ key: string; label: string }> {
  if (quest.stages?.length) return quest.stages.map((stage, index) => ({ key: `s:${index}`, label: `Этап ${index + 1}: ${stage.title}` }))
  const goals = (quest.objectiveDetails ?? []).map((objective) => ({ key: `o:${objective.id}`, label: objective.description }))
  for (const marker of markers) {
    if (marker.questId !== quest.id || !marker.objectiveId || goals.some((entry) => entry.key === `o:${marker.objectiveId}`)) continue
    goals.push({ key: `o:${marker.objectiveId}`, label: marker.description || marker.objectiveId })
  }
  return goals
}

/** The map-hud button and, while editing, the panel: quest search, objective / stage, note, points. */
export function QuestPointControls({ state, maps, markers, quests, onSelectMap, onFocus, onToggle }: {
  state: QuestPointEditorState
  maps: GameMap[]
  markers: MapMarker[]
  quests: Quest[]
  onSelectMap: (mapId: string) => void
  onFocus: (marker: MapMarker) => void
  onToggle?: (active: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => (state.active ? searchQuests(quests, query, state.mapId, state.pointCounts) : []), [state.active, quests, query, state.mapId, state.pointCounts])
  const goals = useMemo(() => (state.quest ? questGoals(state.quest, markers) : []), [state.quest, markers])
  if (!state.enabled) return null
  const toggle = () => { const next = !state.active; state.setActive(next); onToggle?.(next) }
  const quest = state.quest
  const otherMaps = quest ? [...(state.pointCounts.get(quest.id) ?? new Map<string, number>())].filter(([mapId]) => mapId !== state.mapId) : []
  const mapName = (id: string) => maps.find((map) => map.id === id)?.name ?? id
  return (
    <>
      <div className="map-tools quest-point-editor">
        <button type="button" className={`map-tool${state.active ? ' active' : ''}`} aria-pressed={state.active} onClick={toggle} title={uiText('Исправить точку квеста вручную (например, по баг-репорту): исправление увидят все игроки')}>
          <PencilRuler size={14} />{uiText('Квесты: правка точек')}
        </button>
      </div>
      {state.active && (
        <div className="quest-point-panel">
          {!quest ? (
            <>
              <label className="quest-point-search">
                <Search size={13} />
                <input className="input" value={query} autoFocus onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти квест по названию (RU / EN)…')} aria-label={uiText('Найти квест')} />
              </label>
              {query.trim().length >= 2 && !results.length && <small className="dim">{uiText('Квест не найден')}</small>}
              <ul className="quest-point-results">
                {results.map((entry) => {
                  const here = state.pointCounts.get(entry.id)?.get(state.mapId) ?? 0
                  return (
                    <li key={entry.id}>
                      <button type="button" onClick={() => {
                        state.pick(entry.id); setQuery('')
                        // Fly to the quest's first point on this map, if it has one.
                        const first = markers.find((marker) => marker.questId === entry.id && marker.mapId === state.mapId && isQuestPoint(marker))
                        if (first) onFocus(first)
                      }}>
                        <strong>{uiText(entry.name)}</strong>
                        <small className="dim">{uiText(entry.trader)} · {uiText(`Точек на этой карте: ${here}`)}</small>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <>
              <div className="quest-point-head">
                <strong>{uiText(quest.name)}</strong>
                <button type="button" className="icon-button" onClick={() => state.pick('')} aria-label={uiText('Другой квест')} title={uiText('Другой квест')}><X size={14} /></button>
              </div>
              {goals.length > 0 && (
                <select className="input quest-point-select" value={state.goal} onChange={(event) => state.setGoal(event.target.value)} aria-label={uiText('Цель / этап')}>
                  <option value="">{uiText('Все цели и этапы')}</option>
                  {goals.map((entry) => <option key={entry.key} value={entry.key}>{uiText(entry.label)}</option>)}
                </select>
              )}
              <input className="input quest-point-note" value={state.note} maxLength={300} onChange={(event) => state.setNote(event.target.value)} placeholder={uiText('Заметка (например, «по баг-репорту»)')} aria-label={uiText('Заметка')} />
              <div className="quest-point-actions">
                <button type="button" className={`map-tool${state.adding ? ' active' : ''}`} aria-pressed={state.adding} disabled={state.busy} onClick={() => state.setAdding(!state.adding)} title={uiText('Клик по карте — поставить новую точку квеста на выбранный этаж')}>
                  <MapPinPlus size={14} />{uiText('Добавить точку')}
                </button>
                {(state.busy || state.error) && <span className="boss-placement-hint">{state.busy ? <LoaderCircle size={13} className="spin" /> : uiText(state.error)}</span>}
              </div>
              <small className="dim">{uiText('Точку можно перетащить мышью — сохраняется сразу. Новая и перенесённая точка встают на выбранный этаж.')}</small>
              <ul className="quest-point-list">
                {state.points.map((marker, index) => {
                  const override = state.overrideOf(marker)
                  const status = override?.kind === 'add' ? 'Добавлена' : override ? 'Перемещена' : 'Исходная'
                  return (
                    <li key={marker.id}>
                      <button type="button" className="quest-point-name" onClick={() => onFocus(marker)} title={uiText('Показать на карте')}>
                        <Crosshair size={12} />{index + 1}. {uiText(status)}
                        <small className="dim">x {Math.round(marker.position[1])}, z {Math.round(marker.position[0])}</small>
                      </button>
                      <span className="quest-point-row-actions">
                        {override && override.kind !== 'add' && (
                          <button type="button" className="icon-button" disabled={state.busy} onClick={() => void state.reset(override.id)} title={uiText('Вернуть исходную точку')} aria-label={uiText('Вернуть исходную точку')}><RotateCcw size={13} /></button>
                        )}
                        <button type="button" className="icon-button" disabled={state.busy} onClick={() => void state.hide(marker)} title={uiText(override?.kind === 'add' ? 'Удалить добавленную точку' : 'Скрыть неверную точку')} aria-label={uiText('Скрыть')}><EyeOff size={13} /></button>
                      </span>
                    </li>
                  )
                })}
                {state.hidden.map((entry) => (
                  <li key={entry.id} className="is-hidden">
                    <span className="quest-point-name"><EyeOff size={12} />{uiText('Скрыта')}<small className="dim">x {Math.round(entry.x)}, z {Math.round(entry.z)}</small></span>
                    <span className="quest-point-row-actions">
                      <button type="button" className="icon-button" disabled={state.busy} onClick={() => void state.reset(entry.id)} title={uiText('Вернуть исходную точку')} aria-label={uiText('Вернуть исходную точку')}><RotateCcw size={13} /></button>
                    </span>
                  </li>
                ))}
                {!state.points.length && !state.hidden.length && <li className="dim">{uiText('На этой карте у квеста нет точек — нажмите «Добавить точку» и кликните по карте.')}</li>}
              </ul>
              {otherMaps.length > 0 && (
                <div className="quest-point-maps">
                  <small className="dim">{uiText('Точки на других картах:')}</small>
                  {otherMaps.map(([id, count]) => <button key={id} type="button" className="map-tool small" onClick={() => onSelectMap(id)}>{uiText(mapName(id))} · {count}</button>)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}

/** Inside the MapContainer: a click while adding saves a new point (lat = z, lng = x in game metres); hidden points greyed out. */
export function QuestPointEditorLayer({ state }: { state: QuestPointEditorState }) {
  useMapEvents({
    click: (event) => { if (state.adding && !state.busy) void state.add(event.latlng.lng, event.latlng.lat) },
  })
  return (
    <>
      {state.hidden.map((entry) => (
        <CircleMarker key={entry.id} center={[entry.z, entry.x]} radius={9} bubblingMouseEvents={false} pathOptions={{ color: '#9a9a9a', weight: 2, dashArray: '4 3', fillOpacity: 0.15 }}
          eventHandlers={{ click: (event) => { event.originalEvent.stopPropagation(); if (!state.busy) void state.reset(entry.id) } }}>
          <Tooltip direction="top">{uiText('Скрытая точка — клик, чтобы вернуть')}</Tooltip>
        </CircleMarker>
      ))}
    </>
  )
}

/** In the quest card while editing: hide / return the selected point. */
export function QuestPointCardActions({ state, marker, onDone }: { state: QuestPointEditorState; marker: MapMarker | null; onDone: () => void }) {
  if (!state.active || !marker || !marker.questId || marker.questId !== state.questId || !isQuestPoint(marker)) return null
  const override = state.overrideOf(marker)
  return (
    <div className="boss-placement-remove">
      <span className="dim">{uiText(override?.kind === 'add' ? 'Точка добавлена вручную, её видят все игроки.' : override ? 'Точка перенесена вручную, её видят все игроки.' : 'Исходная точка: перетащите её, скройте или добавьте новую — изменения сохраняются сразу и видны всем игрокам.')}</span>
      {override?.note && <small className="dim">{uiText('Заметка')}: {override.note}</small>}
      <div className="boss-placement-actions">
        {override && override.kind !== 'add' && (
          <button type="button" className="button small" disabled={state.busy} onClick={() => void state.reset(override.id)}>
            <RotateCcw size={13} />{uiText('Вернуть исходную точку')}
          </button>
        )}
        <button type="button" className="button small danger" disabled={state.busy} onClick={() => void state.hide(marker).then((ok) => { if (ok) onDone() })}>
          <EyeOff size={13} />{uiText(override?.kind === 'add' ? 'Удалить добавленную точку' : 'Скрыть неверную точку')}
        </button>
      </div>
      {state.error && <small className="account-error">{uiText(state.error)}</small>}
    </div>
  )
}
