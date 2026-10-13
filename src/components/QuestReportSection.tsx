/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react'
import { divIcon, type LeafletMouseEvent } from 'leaflet'
import { CircleMarker, MapContainer, Marker, Tooltip, useMapEvents } from 'react-leaflet'
import { MapPin, Search, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useOptionalTarkovData } from '../data/DataProvider'
import { canLoadGameData, useDataAccess } from '../account/dataAccess'
import { mainFloor } from '../data/mapProjection'
import { planMapLayers } from '../data/mapView'
import { QUEST_ISSUE_LABELS, QUEST_ISSUES, type QuestIssue, type ReportMode } from '../shared/reportCategories'
import type { GameMap, MapMarker, Quest } from '../domain/types'
import { createMapCrs, toLeafletBounds } from './mapCrs'
import { MapFloorLayers } from './MapFloorLayers'
import { questGoals, searchQuests } from './QuestPointEditor'

/** What the player proposes for a quest (the «Квест» category of «Сообщить об ошибке»). */
export interface QuestReportDraft {
  questId: string
  issue: QuestIssue
  mapId?: string
  /** The point on the map the player says is wrong. */
  markerId?: string
  /** `o:<objective id>` / `s:<stage index>` / '' — which objective or stage it is about. */
  goal: string
  /** Where it really is (game metres) and on which floor. */
  point?: { x: number; z: number; floor?: string }
  pointNote: string
  questNote: string
}

/** Issues that are about a place on the map: the map picker is shown for them. */
export const POINT_ISSUES: readonly QuestIssue[] = ['wrong-point', 'missing-point']
const QUEST_SOURCES_EXCLUDED = new Set(['quest-fallback', 'quest-any-map', 'quest-info'])
const isQuestPoint = (marker: MapMarker) => (marker.type === 'quest' || marker.layerId === 'quest.zone' || marker.layerId === 'quest.item') && !QUEST_SOURCES_EXCLUDED.has(marker.source ?? '')
const round = (value: number) => Math.round(value * 10) / 10

/** The `quest` field of POST /v1/bug-reports (server/src/routes/bugReports.ts). */
export function questReportPayload(draft: QuestReportDraft, mode: ReportMode) {
  const pointIssue = POINT_ISSUES.includes(draft.issue)
  const goal = draft.goal.startsWith('o:') ? { objectiveId: draft.goal.slice(2) } : draft.goal.startsWith('s:') ? { stageIndex: Number(draft.goal.slice(2)) } : {}
  return {
    questId: draft.questId,
    issue: draft.issue,
    mode,
    ...(pointIssue && draft.mapId ? { mapId: draft.mapId } : {}),
    ...(pointIssue && draft.markerId ? { markerId: draft.markerId } : {}),
    ...goal,
    ...(pointIssue && draft.point && draft.mapId ? { point: { x: round(draft.point.x), z: round(draft.point.z), ...(draft.point.floor ? { floor: draft.point.floor } : {}) } } : {}),
    ...(pointIssue && draft.pointNote.trim() ? { pointNote: draft.pointNote.trim().slice(0, 300) } : {}),
    ...(draft.questNote.trim() ? { questNote: draft.questNote.trim().slice(0, 1000) } : {}),
  }
}

/** Whether the draft says enough to be sent without a description: a place, a wrong point or a note. */
export function questReportHasContent(draft: QuestReportDraft | null) {
  if (!draft) return false
  return Boolean(draft.questNote.trim() || (POINT_ISSUES.includes(draft.issue) && (draft.point || draft.markerId || draft.pointNote.trim())))
}

/**
 * The «Квест» category (owner, 13.10.2026: «если это не правильный или не актуальный квест, то человек может предложить
 * свою точку на карте этого квеста который он выберет в поиске. и может написать заметку к квесту или точке»): find the
 * quest, say what is wrong, on the map click the wrong point and the place where it really is, add notes. Nothing is
 * changed by it — the owner sees it in «Заявки» together with the players who agree.
 */
export function QuestReportSection({ value, onChange, disabled }: { value: QuestReportDraft | null; onChange: (draft: QuestReportDraft | null) => void; disabled?: boolean }) {
  const data = useOptionalTarkovData()?.data
  const access = canLoadGameData(useDataAccess())
  const available = Boolean(data) && access
  const [query, setQuery] = useState('')
  const counts = useMemo(() => {
    const result = new Map<string, Map<string, number>>()
    for (const marker of data?.markers ?? []) {
      if (!marker.questId || !isQuestPoint(marker)) continue
      const perMap = result.get(marker.questId) ?? new Map<string, number>()
      perMap.set(marker.mapId, (perMap.get(marker.mapId) ?? 0) + 1)
      result.set(marker.questId, perMap)
    }
    return result
  }, [data?.markers])
  const results = useMemo(() => (available && data && !value ? searchQuests(data.quests, query, '', counts, 8) : []), [available, data, value, query, counts])
  const quest = value ? data?.quests.find((entry) => entry.id === value.questId) : undefined

  if (!available || !data) return <p className="muted quest-report-locked">{uiText('Поиск квестов доступен с подпиской. Опишите квест и что не так словами ниже.')}</p>
  if (!value || !quest) {
    return (
      <div className="quest-report">
        <label className="quest-point-search">
          <Search size={13} />
          <input className="input" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найдите квест по названию…')} aria-label={uiText('Найти квест')} />
        </label>
        {query.trim().length >= 2 && !results.length && <small className="dim">{uiText('Квест не найден')}</small>}
        <ul className="quest-point-results">
          {results.map((entry) => (
            <li key={entry.id}>
              <button type="button" disabled={disabled} onClick={() => { setQuery(''); onChange(startDraft(entry, counts)) }}>
                <strong>{uiText(entry.name)}</strong>
                <small className="dim">{uiText(entry.trader)}</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return <QuestReportForm quest={quest} value={value} onChange={onChange} counts={counts} maps={data.maps} markers={data.markers} disabled={disabled} />
}

function startDraft(quest: Quest, counts: Map<string, Map<string, number>>): QuestReportDraft {
  const plotted = [...(counts.get(quest.id) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0]
  return { questId: quest.id, issue: 'wrong-point', mapId: plotted ?? quest.mapId ?? quest.mapIds?.[0], goal: '', pointNote: '', questNote: '' }
}

function QuestReportForm({ quest, value, onChange, counts, maps, markers, disabled }: {
  quest: Quest; value: QuestReportDraft; onChange: (draft: QuestReportDraft | null) => void
  counts: Map<string, Map<string, number>>; maps: GameMap[]; markers: MapMarker[]; disabled?: boolean
}) {
  const set = (patch: Partial<QuestReportDraft>) => onChange({ ...value, ...patch })
  const pointIssue = POINT_ISSUES.includes(value.issue)
  const goals = useMemo(() => questGoals(quest, markers), [quest, markers])
  const questMaps = useMemo(() => {
    const ids = new Set([...(counts.get(quest.id)?.keys() ?? []), ...(quest.mapIds ?? []), ...(quest.mapId ? [quest.mapId] : [])])
    const listed = maps.filter((map) => ids.has(map.id))
    return listed.length ? listed : maps
  }, [counts, quest, maps])
  const map = maps.find((entry) => entry.id === value.mapId) ?? questMaps[0]
  const points = useMemo(() => (map ? markers.filter((marker) => marker.questId === quest.id && marker.mapId === map.id && isQuestPoint(marker)) : []), [markers, quest.id, map])
  const wrong = points.find((marker) => marker.id === value.markerId)
  return (
    <div className="quest-report">
      <div className="quest-point-head">
        <span><strong>{uiText(quest.name)}</strong> <small className="dim">{uiText(quest.trader)}</small></span>
        <button type="button" className="icon-button" disabled={disabled} onClick={() => onChange(null)} aria-label={uiText('Другой квест')} title={uiText('Другой квест')}><X size={14} /></button>
      </div>
      <div className="quest-report-issues" role="radiogroup" aria-label={uiText('Что не так')}>
        {QUEST_ISSUES.map((issue) => (
          <button key={issue} type="button" role="radio" aria-checked={value.issue === issue} className={`bug-report-chip${value.issue === issue ? ' active' : ''}`} disabled={disabled} onClick={() => set({ issue })}>
            {uiText(QUEST_ISSUE_LABELS[issue])}
          </button>
        ))}
      </div>
      {goals.length > 0 && (
        <select className="input" value={value.goal} disabled={disabled} onChange={(event) => set({ goal: event.target.value })} aria-label={uiText('Цель / этап')}>
          <option value="">{uiText('Все цели и этапы')}</option>
          {goals.map((entry) => <option key={entry.key} value={entry.key}>{uiText(entry.label)}</option>)}
        </select>
      )}
      {pointIssue && map && (
        <>
          <div className="quest-report-map-head">
            <select className="input" value={map.id} disabled={disabled} onChange={(event) => set({ mapId: event.target.value, markerId: undefined, point: undefined })} aria-label={uiText('Карта')}>
              {questMaps.map((entry) => <option key={entry.id} value={entry.id}>{uiText(entry.name)}</option>)}
            </select>
            {map.layers && map.layers.length > 1 && (
              <select className="input" value={value.point?.floor ?? ''} disabled={disabled || !value.point} onChange={(event) => value.point && set({ point: { ...value.point, floor: event.target.value || undefined } })} aria-label={uiText('Этаж')}>
                <option value="">{uiText(mainFloor(map))}</option>
                {map.layers.filter((layer) => layer.name !== mainFloor(map)).map((layer) => <option key={layer.name} value={layer.name}>{uiText(layer.name)}</option>)}
              </select>
            )}
          </div>
          <small className="dim">{uiText(value.issue === 'wrong-point'
            ? 'Нажмите на неверную точку квеста (жёлтые кружки), затем на место, где она на самом деле. Метку можно перетащить.'
            : 'Нажмите на карте место, где должна быть точка. Метку можно перетащить.')}</small>
          <QuestPointPicker
            map={map}
            points={points}
            wrongId={value.markerId}
            proposal={value.point}
            onPickWrong={(marker) => set({ markerId: marker.id === value.markerId ? undefined : marker.id, ...(marker.objectiveId ? { goal: `o:${marker.objectiveId}` } : marker.stageIndex != null ? { goal: `s:${marker.stageIndex}` } : {}) })}
            onPlace={(x, z) => set({ point: { x, z, ...(value.point?.floor ? { floor: value.point.floor } : {}) } })}
          />
          <div className="quest-report-picked">
            <span><MapPin size={12} />{wrong ? uiText('Неверная точка выбрана') : uiText(value.issue === 'wrong-point' ? 'Неверная точка не выбрана' : 'Точек квеста на этой карте: ') + (value.issue === 'wrong-point' ? '' : String(points.length))}</span>
            <span>{value.point ? `${uiText('Ваше место')}: x ${Math.round(value.point.x)}, z ${Math.round(value.point.z)}` : uiText('Место ещё не отмечено')}</span>
            {value.point && <button type="button" className="button small ghost" disabled={disabled} onClick={() => set({ point: undefined })}>{uiText('Убрать метку')}</button>}
          </div>
          <input className="input" value={value.pointNote} maxLength={300} disabled={disabled} onChange={(event) => set({ pointNote: event.target.value })} placeholder={uiText('Заметка к точке: например, «в подвале за красной дверью»')} aria-label={uiText('Заметка к точке')} />
        </>
      )}
      <textarea className="input" rows={3} value={value.questNote} maxLength={1000} disabled={disabled} onChange={(event) => set({ questNote: event.target.value })} placeholder={uiText('Заметка к квесту: что изменилось или что написано неверно')} aria-label={uiText('Заметка к квесту')} />
    </div>
  )
}

const proposalIcon = divIcon({ className: 'marker-icon', html: '<div class="quest-report-pin"><span></span></div>', iconSize: [24, 24], iconAnchor: [12, 12] })

/** The map of the report: the quest's points (a click marks the wrong one), a click elsewhere places the proposed spot. */
function QuestPointPicker({ map, points, wrongId, proposal, onPickWrong, onPlace }: {
  map: GameMap; points: MapMarker[]; wrongId?: string; proposal?: { x: number; z: number }
  onPickWrong: (marker: MapMarker) => void; onPlace: (x: number, z: number) => void
}) {
  const crs = useMemo(() => createMapCrs(map), [map])
  const level = mainFloor(map)
  const plan = useMemo(() => planMapLayers(map, 'satellite', level), [map, level])
  return (
    <div className="quest-report-map" aria-label={uiText('Карта квеста')}>
      <MapContainer key={map.id} crs={crs} bounds={toLeafletBounds(map)} zoomSnap={0.25} minZoom={Math.min(-5, map.minZoom ?? -1)} maxZoom={Math.max(7, map.maxZoom ?? 3)} attributionControl={false}>
        <MapFloorLayers map={map} plan={plan} floor={level} />
        <PlaceOnClick onPlace={onPlace} />
        {points.map((marker) => (
          <CircleMarker key={marker.id} center={marker.position} radius={marker.id === wrongId ? 10 : 7} bubblingMouseEvents={false}
            pathOptions={marker.id === wrongId ? { color: '#e05a47', weight: 3, fillOpacity: 0.5 } : { color: '#e8c35a', weight: 2, fillOpacity: 0.35 }}
            eventHandlers={{ click: () => onPickWrong(marker) }}>
            <Tooltip direction="top">{uiText(marker.id === wrongId ? 'Неверная точка' : marker.description || marker.title || 'Точка квеста')}</Tooltip>
          </CircleMarker>
        ))}
        {proposal && (
          <Marker position={[proposal.z, proposal.x]} icon={proposalIcon} draggable
            eventHandlers={{ dragend: (event) => { const at = (event.target as { getLatLng: () => { lat: number; lng: number } }).getLatLng(); onPlace(at.lng, at.lat) } }} />
        )}
      </MapContainer>
    </div>
  )
}

function PlaceOnClick({ onPlace }: { onPlace: (x: number, z: number) => void }) {
  useMapEvents({ click: (event: LeafletMouseEvent) => onPlace(event.latlng.lng, event.latlng.lat) })
  return null
}
