import { divIcon, type DivIcon } from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'
import { LoaderCircle, Users } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { FriendQuestLayer, FriendQuestPoint } from './friendQuestLayer'

/** The button at the top of the map, and while it is on, who is shown in which colour. */
export function FriendQuestToggle({ layer }: { layer: FriendQuestLayer }) {
  if (!layer.available) return null
  const none = !layer.sharing
  return <div className="map-tools map-friend-quests">
    <button type="button" className={`map-tool${layer.on ? ' active' : ''}`} aria-pressed={layer.on} disabled={none} onClick={layer.toggle}
      title={uiText(none ? 'Никто из друзей пока не открыл свой прогресс' : 'Точки заданий друзей их цветами из раздела «Друзья»')}>
      {layer.loading ? <LoaderCircle className="spin" size={14} /> : <Users size={14} />}<span>{uiText('Квесты друзей')}</span>
    </button>
    {layer.on && layer.legend.length > 0 && <span className="map-friend-legend">
      {layer.legend.map((entry) => <span key={entry.friendId} style={{ color: entry.color }} title={`${uiText('Заданий на этой карте')}: ${entry.quests}`}>
        <i style={{ background: entry.color }} />{entry.nickname} <b>{entry.quests}</b>
      </span>)}
    </span>}
    {layer.on && layer.error && <span className="map-friend-legend is-error">{uiText(layer.error)}</span>}
  </div>
}

const icons = new Map<string, DivIcon>()
/** One icon per colour and place in a row (friends on the same point stand side by side). */
function pinIcon(color: string, slot: number) {
  const key = `${color}:${slot}`
  let icon = icons.get(key)
  if (!icon) {
    icon = divIcon({ className: 'friend-quest-pin', html: `<span style="--friend:${color}"></span>`, iconSize: [16, 16], iconAnchor: [8 - slot * 13, 8] })
    icons.set(key, icon)
  }
  return icon
}

/** The friends' points on the Leaflet map (inside MapContainer). */
export function FriendQuestMarkers({ points }: { points: FriendQuestPoint[] }) {
  return <>
    {points.map((point) => <Marker key={point.key} position={point.position} zIndexOffset={-100} keyboard={false} icon={pinIcon(point.color, point.slot)}>
      <Tooltip direction="top" offset={[point.slot * 13, -8]} opacity={1} className="map-marker-tooltip">
        <span className="friend-quest-tip"><b style={{ color: point.color }}>{point.nickname}</b> · {uiText(point.questName)}{point.label !== point.questName ? <><br /><small>{uiText(point.label)}</small></> : null}</span>
      </Tooltip>
    </Marker>)}
  </>
}
