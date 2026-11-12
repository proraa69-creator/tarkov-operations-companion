/* eslint-disable react-refresh/only-export-components */
import { useMemo } from 'react'
import { divIcon } from 'leaflet'
import { MapContainer, Marker } from 'react-leaflet'
import { AlertTriangle, CheckCircle2, Gift, ImagePlus, Package, Search, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { markerImages } from '../assets/markerImages'
import { mainFloor, markerFloor } from '../data/mapProjection'
import { planMapLayers } from '../data/mapView'
import { withinBounds } from '../overlay/positionMap'
import { parseScreenshotPosition } from '../overlay/screenshotPosition'
import {
  POINT_SUGGESTION_BLOCKS, POINT_SUGGESTION_NAME_MAX, POINT_SUGGESTION_SHOT_MAX, pointSuggestionBlock, pointSuggestionLabel, pointSuggestionNeeds, pointSuggestionTopic,
  samePlacedPoint, type PlacedPoint, type PointSuggestionInput,
} from '../shared/pointSuggestion'
import type { QuestPointIcon } from '../shared/questPointConstructor'
import type { ReportMode } from '../shared/reportCategories'
import type { GameMap, Item, MapMarker, Quest } from '../domain/types'
import { hidesPayments } from '../platform'
import { createMapCrs, toLeafletBounds } from './mapCrs'
import { MapFloorLayers } from './MapFloorLayers'
import { searchQuests } from './QuestPointEditor'
import { searchCatalogItems } from './QuestRequirementsEditor'

/** What the player has chosen so far in «Добавить точку». */
export interface PointDraft {
  icon?: QuestPointIcon
  /** The name as typed, or the picked item's / quest's own name. */
  name: string
  itemId?: string
  questId?: string
  mapId: string
}

export const emptyPointDraft = (mapId: string): PointDraft => ({ name: '', mapId })

/** The condition the owner asked to be written (10.11.2026: «чтобы подтвердить точку, ему нужно прислать скриншот»). */
export const POINT_CONDITION = 'Чтобы подтвердить точку, пришлите скриншот из игры: по его координатам она встанет на карту.'
/** «За каждую точку дается 1 бонус. При условии, что этой точки нет на карте». */
export const POINT_BONUS = 'За точку, которой ещё нет на карте, — 1 бонус: +1 день подписки.'

type Data = { maps: GameMap[]; markers: MapMarker[]; quests: Quest[]; items: Item[] }

const placedOf = (marker: MapMarker): PlacedPoint => ({
  icon: marker.layerId, mapId: marker.mapId, x: marker.position[1], z: marker.position[0],
  ...(marker.questId ? { questId: marker.questId } : {}),
  ...(marker.keyIds?.length ? { itemIds: marker.keyIds } : marker.itemId ? { itemIds: [marker.itemId] } : {}),
})

/**
 * Where the draft stands: the place read from the game screenshot among the attached pictures, what is still missing
 * (`problem`, the first thing to do) and, when nothing is, what goes to the server (`payload`) with the report's topic.
 */
export function pointDraftState(draft: PointDraft, shots: ReadonlyArray<{ name: string }>, data: Pick<Data, 'maps' | 'markers'> | undefined, mode: ReportMode) {
  const shot = shots.find((entry) => parseScreenshotPosition(entry.name, 0))
  const at = shot ? parseScreenshotPosition(shot.name, 0) : null
  const map = data?.maps.find((entry) => entry.id === draft.mapId)
  const name = draft.name.trim().slice(0, POINT_SUGGESTION_NAME_MAX)
  const needs = draft.icon ? pointSuggestionNeeds(draft.icon) : undefined
  const outside = Boolean(at && map?.bounds && !withinBounds(at, map.bounds))
  const level = at && map ? markerFloor(map, undefined, [at.z, at.x], at.y) : undefined
  const floor = level && map && level !== mainFloor(map) ? level : undefined
  const duplicate = at && draft.icon && data && !outside
    ? samePlacedPoint({ icon: draft.icon, mapId: draft.mapId, x: at.x, z: at.z, questId: needs === 'quest' ? draft.questId : undefined, itemId: draft.itemId }, data.markers.filter((marker) => marker.mapId === draft.mapId && marker.layerId === draft.icon).map(placedOf))
    : undefined
  const problem = !draft.icon ? 'Выберите значок точки.'
    : needs === 'quest' && !draft.questId ? 'Найдите квест и выберите его из списка.'
      : needs === 'item' && !draft.itemId ? 'Найдите ключ и выберите его из списка.'
        : !name ? 'Напишите название точки.'
          : !map ? 'Выберите карту.'
            : !shot || !at ? (shots.length ? 'В имени файла нет координат. Нужен скриншот из игры, файл не переименовывать.' : 'Приложите скриншот из игры.')
              : outside ? 'Координаты скриншота не с этой карты. Выберите другую карту.'
                : duplicate ? 'Такая точка уже есть на карте.'
                  : ''
  const payload: PointSuggestionInput | undefined = !problem && draft.icon && shot ? {
    icon: draft.icon, name, mapId: draft.mapId, shot: shot.name.slice(0, POINT_SUGGESTION_SHOT_MAX), mode,
    ...(floor ? { floor } : {}), ...(draft.itemId ? { itemId: draft.itemId } : {}), ...(needs === 'quest' && draft.questId ? { questId: draft.questId } : {}),
  } : undefined
  return { at, map, floor, outside, duplicate: Boolean(duplicate), problem, payload, topic: draft.icon && name ? pointSuggestionTopic(draft.icon, name) : '' }
}

const normalize = (text: string) => text.toLowerCase().replace(/ё/g, 'е').trim()

/** What the name field offers under it for this emblem: quests, catalog items, or the names of such points on the maps. */
function suggestions(draft: PointDraft, data: Data): Array<{ key: string; name: string; note?: string; picture?: string; itemId?: string; questId?: string }> {
  if (!draft.icon || draft.itemId || draft.questId) return []
  const needs = pointSuggestionNeeds(draft.icon)
  const block = pointSuggestionBlock(draft.icon)?.id
  if (needs === 'quest') return searchQuests(data.quests, draft.name, draft.mapId, new Map(), 8).map((quest) => ({ key: quest.id, name: quest.name, note: quest.trader, questId: quest.id }))
  if (block === 'keys' || (block === 'items' && draft.icon !== 'loot.container')) {
    return searchCatalogItems(data.items, draft.name, block === 'keys' ? 'keys' : 'items', 8).map((item) => ({ key: item.id, name: item.name, note: item.category, picture: item.iconUrl, itemId: item.id }))
  }
  // Containers and exits are not catalog items: the names such points already carry on the maps.
  const query = normalize(draft.name)
  if (query.length < 2) return []
  const names = new Set<string>()
  for (const marker of data.markers) {
    if (marker.layerId !== draft.icon || !marker.title || names.has(marker.title)) continue
    if (normalize(marker.title).includes(query) || normalize(uiText(marker.title)).includes(query)) names.add(marker.title)
    if (names.size >= 8) break
  }
  return [...names].filter((title) => normalize(title) !== query).map((title) => ({ key: title, name: title }))
}

const pinIcon = divIcon({ className: 'marker-icon', html: '<div class="quest-report-pin"><span></span></div>', iconSize: [24, 24], iconAnchor: [12, 12] })

/** The map with the point where the screenshot was taken. */
function PointPreview({ map, floor, at }: { map: GameMap; floor?: string; at: { x: number; z: number } }) {
  const crs = useMemo(() => createMapCrs(map), [map])
  const level = floor || mainFloor(map)
  const plan = useMemo(() => planMapLayers(map, 'satellite', level), [map, level])
  return (
    <div className="quest-report-map suggest-point-map" aria-label={uiText('Точка на карте')}>
      <MapContainer key={`${map.id}:${level}`} crs={crs} bounds={toLeafletBounds(map)} zoomSnap={0.25} minZoom={Math.min(-5, map.minZoom ?? -1)} maxZoom={Math.max(7, map.maxZoom ?? 3)} attributionControl={false}>
        <MapFloorLayers map={map} plan={plan} floor={level} />
        <Marker position={[at.z, at.x]} icon={pinIcon} interactive={false} />
      </MapContainer>
    </div>
  )
}

/**
 * «Ваши предложения» → «Добавить точку» (owner, 10.11.2026): the map's emblems in four rows — «Выходы и переходы»,
 * «Задания», «Ключи», «Предметы» —, a name that finds the item or the quest as it is typed, the map, and the place taken
 * from the game screenshot attached below (the game writes the coordinates into the file's name). Nothing is placed by
 * hand. The owner accepts the point in «Отчёты»; the same point twice is refused here already.
 */
export function SuggestPointSection({ value, onChange, shots, data, mode, disabled, onPickFiles }: {
  value: PointDraft; onChange: (draft: PointDraft) => void; shots: ReadonlyArray<{ name: string }>; data: Data; mode: ReportMode; disabled?: boolean; onPickFiles?: () => void
}) {
  const state = useMemo(() => pointDraftState(value, shots, data, mode), [value, shots, data, mode])
  const found = useMemo(() => suggestions(value, data), [value, data])
  const needs = value.icon ? pointSuggestionNeeds(value.icon) : undefined
  const picked = value.itemId ? data.items.find((item) => item.id === value.itemId) : undefined
  const pickedQuest = value.questId ? data.quests.find((quest) => quest.id === value.questId) : undefined
  const placeholder = needs === 'quest' ? 'Название квеста…' : needs === 'item' ? 'Название ключа…' : value.icon && pointSuggestionBlock(value.icon)?.id === 'items' ? 'Название предмета или места…' : 'Название точки…'
  return (
    <div className="suggest-point">
      <div className="bug-report-reward suggest-point-terms">
        {hidesPayments() ? <ImagePlus size={20} aria-hidden="true" /> : <Gift size={20} aria-hidden="true" />}
        <div><strong>{uiText(POINT_CONDITION)}</strong>{!hidesPayments() && <span>{uiText(POINT_BONUS)}</span>}</div>
      </div>
      <div className="suggest-point-blocks" role="radiogroup" aria-label={uiText('Значок точки')}>
        {POINT_SUGGESTION_BLOCKS.map((block) => (
          <div className="suggest-point-row" key={block.id}>
            <small>{uiText(block.title)}</small>
            <div>
              {block.icons.map((icon) => (
                <button key={icon} type="button" role="radio" aria-checked={value.icon === icon} disabled={disabled} className={`suggest-point-icon${value.icon === icon ? ' active' : ''}`}
                  onClick={() => onChange({ icon, name: '', mapId: value.mapId })}>
                  <img className={`layer-${icon.replace('.', '-')}`} src={markerImages[icon]} alt="" />
                  <span>{uiText(pointSuggestionLabel(icon))}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {value.icon && <>
        {picked || pickedQuest ? (
          <div className="suggest-point-picked">
            {picked?.iconUrl ? <img src={picked.iconUrl} alt="" /> : picked ? <span className="quest-req-icon"><Package size={16} /></span> : <img src={markerImages[value.icon]} alt="" />}
            <span><strong>{uiText(picked?.name ?? pickedQuest!.name)}</strong><small className="dim">{uiText(picked?.category ?? pickedQuest!.trader)}</small></span>
            <button type="button" className="icon-button" disabled={disabled} onClick={() => onChange({ icon: value.icon, name: '', mapId: value.mapId })} aria-label={uiText('Выбрать другое')} title={uiText('Выбрать другое')}><X size={14} /></button>
          </div>
        ) : (
          <label className="quest-point-search">
            <Search size={13} />
            <input className="input" value={value.name} maxLength={POINT_SUGGESTION_NAME_MAX} disabled={disabled} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder={uiText(placeholder)} aria-label={uiText('Название точки')} />
          </label>
        )}
        {found.length > 0 && (
          <ul className="suggest-point-results" aria-label={uiText('Найдено')}>
            {found.map((entry) => (
              <li key={entry.key}>
                <button type="button" disabled={disabled} onClick={() => onChange({ ...value, name: entry.name, ...(entry.itemId ? { itemId: entry.itemId } : {}), ...(entry.questId ? { questId: entry.questId } : {}) })}>
                  {entry.picture ? <img src={entry.picture} alt="" loading="lazy" /> : <img src={markerImages[value.icon!]} alt="" />}
                  <span><strong>{uiText(entry.name)}</strong>{entry.note && <small>{uiText(entry.note)}</small>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="field-label suggest-point-map-pick">{uiText('Карта')}
          <select className="input" value={value.mapId} disabled={disabled} onChange={(event) => onChange({ ...value, mapId: event.target.value })}>
            {data.maps.map((map) => <option key={map.id} value={map.id}>{uiText(map.name)}</option>)}
          </select>
        </label>
        {state.at ? (
          <div className={`suggest-point-place${state.outside || state.duplicate ? ' is-problem' : ''}`} role="status">
            {state.outside || state.duplicate ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
            <span>{uiText(state.outside ? 'Координаты скриншота не с этой карты. Выберите другую карту.' : state.duplicate ? 'Такая точка уже есть на карте.' : 'Место взято со скриншота')}{state.outside || state.duplicate ? '' : `: x ${Math.round(state.at.x)}, z ${Math.round(state.at.z)}${state.floor ? ` · ${uiText(state.floor)}` : ''}`}</span>
          </div>
        ) : (
          <div className="suggest-point-place is-waiting">
            <ImagePlus size={15} />
            <span>{uiText(shots.length ? 'В имени файла нет координат. Нужен скриншот из игры, файл не переименовывать.' : 'Приложите скриншот из игры: «Документы» → Escape from Tarkov → Screenshots.')}</span>
            {onPickFiles && <button type="button" className="button small ghost" disabled={disabled} onClick={onPickFiles}>{uiText('Выбрать скриншот')}</button>}
          </div>
        )}
        {state.at && state.map && !state.outside && <PointPreview map={state.map} floor={state.floor} at={state.at} />}
      </>}
    </div>
  )
}
