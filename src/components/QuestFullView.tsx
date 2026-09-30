import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CheckCircle2, ExternalLink, Lock, MapPin, Package, Target, Trophy, Unlock } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useTarkovData } from '../data/DataProvider'
import { readMapView } from '../data/mapView'
import { MarkerMiniMap } from './MarkerMiniMap'
import { mapsForQuest } from '../progression/questLocation'
import { followUpQuests, prerequisiteIds } from '../progression/questChronology'
import type { TaskAvailability } from '../progression/requirementEngine'
import type { MapMarker, Quest, TaskProgressStatus } from '../domain/types'
import { questStatusText } from '../shared/questStatus'
import './traderQuests.css'

interface QuestFullViewProps {
  quest: Quest
  availability: Map<string, TaskAvailability>
  /** Opens another quest (a prerequisite or a follow-up) in this same view. */
  onOpenQuest: (questId: string) => void
}

const PURPOSES: Record<string, string> = {
  place: 'Заложить',
  mark: 'Пометить',
  key: 'Ключ',
  bring: 'Взять с собой',
  handover: 'Передать торговцу',
  find: 'Найти в рейде',
}

/** How many map fragments with the quest's points are drawn (each one is a small Leaflet map). */
const MAX_MINI_MAPS = 4

/**
 * Full description of one trader quest: objectives, conditions, items with pictures, the quest image,
 * the places on the map (map fragments from the marker data) and rewards.
 */
export function QuestFullView({ quest, availability, onOpenQuest }: QuestFullViewProps) {
  const { data } = useTarkovData()
  const [imageBroken, setImageBroken] = useState(false)
  const status = availability.get(quest.id)?.status ?? 'unknown'
  const itemsById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const mapName = (id: string) => data.maps.find((map) => map.id === id)?.name ?? id
  const maps = quest.anyMap ? [] : mapsForQuest(quest, data.maps)
  const firstMap = maps[0]?.id

  const previous = prerequisiteIds(quest).map((id) => data.quests.find((entry) => entry.id === id)).filter((entry): entry is Quest => Boolean(entry))
  const next = followUpQuests(quest, data.quests).filter((entry) => !entry.id.startsWith('wiki:'))

  // One row per item: what to do with it (plant, mark, key…) and how many.
  const itemRows = useMemo(() => {
    const rows = new Map<string, { itemId: string; count: number; purposes: Set<string>; mapIds: Set<string> }>()
    for (const requirement of quest.raidRequirements ?? []) {
      const row = rows.get(requirement.itemId) ?? { itemId: requirement.itemId, count: 0, purposes: new Set<string>(), mapIds: new Set<string>() }
      row.count = Math.max(row.count, requirement.count)
      row.purposes.add(requirement.purpose)
      requirement.mapIds.forEach((id) => row.mapIds.add(id))
      rows.set(requirement.itemId, row)
    }
    for (const itemId of quest.requiredItems ?? []) {
      if (!rows.has(itemId)) rows.set(itemId, { itemId, count: 1, purposes: new Set(), mapIds: new Set() })
    }
    return [...rows.values()].filter((row) => itemsById.has(row.itemId))
  }, [itemsById, quest.raidRequirements, quest.requiredItems])

  // Exact points only — never a map-centre guess.
  const points = useMemo(() => {
    const seen = new Set<string>()
    return data.markers.filter((marker) => {
      if (marker.questId !== quest.id || marker.approximate || !hasRealCoordinates(marker)) return false
      const key = `${marker.mapId}:${marker.position.join(',')}`
      if (seen.has(key)) return false
      seen.add(key)
      return data.maps.some((map) => map.id === marker.mapId)
    })
  }, [data.maps, data.markers, quest.id])
  const shownPoints = points.slice(0, MAX_MINI_MAPS)
  const mapView = readMapView()

  return <div className="quest-full">
    <div className="detail-hero quest-full-hero">
      <div className="eyebrow">{uiText(quest.trader)} · {uiText(`уровень ${quest.level}`)}</div>
      <h2>{uiText(quest.name)}</h2>
      <div className="quest-full-tags">
        <span className={`tag ${statusTone(status)}`}>{uiText(questStatusText(status))}</span>
        {quest.kappa && <span className="tag brass">{uiText('капа')}</span>}
        {factionLabel(quest.faction) && <span className="tag">{uiText(factionLabel(quest.faction))}</span>}
        {quest.anyMap && <span className="tag"><MapPin size={11} /> {uiText('Любая карта')}</span>}
        {maps.map((map) => <span className="tag" key={map.id}><MapPin size={11} /> {uiText(map.name)}</span>)}
      </div>
    </div>

    {quest.imageUrl && !imageBroken && <figure className="quest-full-image">
      <img src={quest.imageUrl} alt={uiText(quest.name)} loading="lazy" onError={() => setImageBroken(true)} />
    </figure>}

    {quest.description && <div className="detail-section"><h4>{uiText('Задача')}</h4><p>{uiText(quest.description)}</p></div>}

    <div className="detail-section">
      <h4>{uiText('Цели')}</h4>
      {quest.objectives.length
        ? <ol className="quest-full-objectives">{quest.objectives.map((objective, index) => <li key={`${objective}-${index}`}><Target size={14} /><span>{uiText(objective)}</span></li>)}</ol>
        : <p className="dim">{uiText('Подробные цели временно недоступны.')}</p>}
    </div>

    <div className="detail-section">
      <h4>{uiText('Условия')}</h4>
      <div className="quest-full-conditions">
        <span className="quest-full-condition"><Unlock size={14} />{uiText(`Уровень персонажа от ${quest.level}`)}</span>
        {factionLabel(quest.faction) && <span className="quest-full-condition"><Lock size={14} />{uiText(`Только для ${factionLabel(quest.faction)}`)}</span>}
        {previous.map((entry) => {
          const done = availability.get(entry.id)?.status === 'completed'
          // A finished prerequisite is only shown (like finished quests in the list), an open one can be opened.
          return done
            ? <span key={entry.id} className="quest-full-link is-done"><CheckCircle2 size={14} /><span>{uiText('Выполнить')} «{uiText(entry.name)}»</span><small>{uiText(entry.trader)}</small></span>
            : <button type="button" key={entry.id} className="quest-full-link" onClick={() => onOpenQuest(entry.id)}>
              <Lock size={14} /><span>{uiText('Выполнить')} «{uiText(entry.name)}»</span><small>{uiText(entry.trader)}</small>
            </button>
        })}
      </div>
    </div>

    {itemRows.length > 0 && <div className="detail-section">
      <h4>{uiText('Предметы')}</h4>
      <div className="quest-full-items">
        {itemRows.map((row) => {
          const item = itemsById.get(row.itemId)!
          return <Link className="quest-full-item" key={row.itemId} to={`/flea?selected=${row.itemId}`}>
            {item.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="quest-full-item-empty"><Package size={18} /></span>}
            <span>
              <strong>{uiText(item.name)}{row.count > 1 ? ` ×${row.count}` : ''}</strong>
              <small>{uiText([...row.purposes].map((purpose) => PURPOSES[purpose] ?? purpose).join(' · ') || item.category)}{row.mapIds.size ? ` · ${[...row.mapIds].map((id) => uiText(mapName(id))).join(', ')}` : ''}</small>
            </span>
          </Link>
        })}
      </div>
    </div>}

    {(shownPoints.length > 0 || firstMap || quest.anyMap) && <div className="detail-section">
      <h4>{uiText('Где выполнять')}</h4>
      {shownPoints.length > 0 && <div className="quest-full-places">
        {shownPoints.map((marker) => {
          const map = data.maps.find((entry) => entry.id === marker.mapId)!
          const item = marker.itemId ? itemsById.get(marker.itemId) : undefined
          return <figure className="quest-full-place" key={marker.id}>
            <MarkerMiniMap map={map} view={mapView} position={marker.position} color="#d6a64f" />
            <figcaption>
              {item?.iconUrl && <img src={item.iconUrl} alt="" loading="lazy" />}
              <span>
                <strong>{uiText(map.name)}{marker.floor ? ` · ${uiText(marker.floor)}` : ''}</strong>
                <small>{uiText(markerCaption(marker, item?.name))}</small>
              </span>
              <Link className="icon-button" to={`/maps/${marker.mapId}?quest=${encodeURIComponent(quest.id)}`} title={uiText('Показать на карте')} aria-label={uiText('Показать на карте')}><ArrowUpRight size={15} /></Link>
            </figcaption>
          </figure>
        })}
      </div>}
      {points.length > shownPoints.length && <p className="dim quest-full-more">{uiText(`Ещё точек на карте: ${points.length - shownPoints.length}`)}</p>}
      {shownPoints.length === 0 && <p className="dim">{uiText(quest.anyMap ? 'Задание выполняется на любой карте.' : 'Точных точек для этого задания в данных нет — место указано в целях.')}</p>}
    </div>}

    <div className="detail-section">
      <h4>{uiText('Награды')}</h4>
      {quest.rewards.length
        ? <div className="quest-full-rewards">{quest.rewards.map((reward) => <span key={reward}><Trophy size={14} />{uiText(reward)}</span>)}</div>
        : <p className="dim">{uiText('Награды на Wiki не указаны.')}</p>}
    </div>

    {next.length > 0 && <div className="detail-section">
      <h4>{uiText('Открывает задания')}</h4>
      <div className="quest-full-conditions">
        {next.map((entry) => availability.get(entry.id)?.status === 'completed'
          ? <span key={entry.id} className="quest-full-link is-done"><CheckCircle2 size={14} /><span>{uiText(entry.name)}</span><small>{uiText(entry.trader)}</small></span>
          : <button type="button" key={entry.id} className="quest-full-link" onClick={() => onOpenQuest(entry.id)}>
            <ArrowUpRight size={14} /><span>{uiText(entry.name)}</span><small>{uiText(entry.trader)}</small>
          </button>)}
      </div>
    </div>}

    <div className="detail-section stack quest-full-actions">
      {(firstMap || quest.anyMap) && <Link className="button ghost" to={`/maps/${firstMap ?? data.maps[0]?.id ?? 'customs'}?quest=${encodeURIComponent(quest.id)}`}><MapPin size={15} />{uiText(' Показать на карте')}</Link>}
      {quest.wikiLink && <a className="button ghost" href={quest.wikiLink} target="_blank" rel="noreferrer"><ExternalLink size={15} />{uiText(' Страница на Wiki')}</a>}
    </div>
  </div>
}

function statusTone(status: TaskProgressStatus) {
  if (status === 'completed') return 'green'
  if (status === 'failed') return 'danger'
  if (status === 'active' || status === 'available') return 'brass'
  return ''
}

function factionLabel(faction?: string) {
  const key = faction?.trim().toLowerCase() ?? ''
  if (/^(usec|юсек)$/.test(key)) return 'USEC'
  if (/^(bear|беар|бир)$/.test(key)) return 'BEAR'
  return ''
}

function markerCaption(marker: MapMarker, itemName?: string) {
  if (itemName) return itemName
  if (marker.description && marker.description !== marker.title) return marker.description
  return marker.title
}

function hasRealCoordinates(marker: MapMarker) {
  const [lat, lng] = marker.position
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
}
