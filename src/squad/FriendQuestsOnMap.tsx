import { divIcon, type DivIcon } from 'leaflet'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Marker, Popup, Tooltip } from 'react-leaflet'
import { ChevronRight, LoaderCircle, Users, UsersRound, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useMobileLayout } from '../platform'
import { questCardHref } from '../quests/questCardLink'
import type { FriendQuestLayer, FriendQuestPoint } from './friendQuestLayer'
import { useMapDragged } from '../maps/mapDragGuard'

/** The button at the top of the map, and while it is on, who is shown in which colour. */
export function FriendQuestToggle({ layer }: { layer: FriendQuestLayer }) {
  if (!layer.available) return null
  const none = !layer.sharing
  const squad = layer.who === 'squad'
  return <div className={`map-tools map-friend-quests${squad ? ' is-squad' : ''}`}>
    <button type="button" className={`map-tool${layer.on ? ' active' : ''}`} aria-pressed={layer.on} disabled={none} onClick={layer.toggle}
      title={uiText(squad ? 'Квесты отряда их цветами' : none ? 'Нет друзей с открытым прогрессом' : 'Квесты друзей их цветами')}>
      {layer.loading ? <LoaderCircle className="spin" size={14} /> : squad ? <UsersRound size={14} /> : <Users size={14} />}<span>{uiText(squad ? 'Квесты отряда' : 'Квесты друзей')}</span>
    </button>
    {layer.on && layer.legend.length > 0 && <span className="map-friend-legend">
      {layer.legend.map((entry) => <span key={entry.friendId} style={{ color: entry.color }} title={`${entry.squad ? `${uiText('Отряд')} · ` : ''}${uiText('Заданий на этой карте')}: ${entry.quests}`}>
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

/**
 * The friends' points on the Leaflet map (inside MapContainer). A press on one opens a small window of the friend's quest at
 * the point, not the map's quest panel (owner, 08.11.2026: «По этим точкам на карте можно нажать и посмотреть, и будет
 * открываться окно квеста, который у него по данной точке… В соответствии с цветом друга… Миниатюра, но не нижнее меню, а
 * только окно»). On the PC it opens at the point, kept clear of the buttons over the map, and the name still shows on hover;
 * on the phone those buttons cover the top of the map, so the window stands over the map by itself.
 */
export function FriendQuestMarkers({ points }: { points: FriendQuestPoint[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const mobile = useMobileLayout()
  // a press that dragged the map opens nothing (report №97)
  const dragged = useMapDragged()
  const shown = open ? points.find((point) => point.key === open) : undefined
  return <>
    {points.map((point) => <Marker key={point.key} position={point.position} zIndexOffset={-100} keyboard={false} icon={pinIcon(point.color, point.slot)}
      eventHandlers={{ click: (event) => { if (dragged.current) return; event.target.closeTooltip(); setOpen(point.key) } }}>
      {!mobile && open !== point.key && <Tooltip direction="top" offset={[point.slot * 13, -8]} opacity={1} className="map-marker-tooltip">
        <span className="friend-quest-tip"><b style={{ color: point.color }}>{point.nickname}</b> · {uiText(point.questName)}{point.label !== point.questName ? <><br /><small>{uiText(point.label)}</small></> : null}</span>
      </Tooltip>}
    </Marker>)}
    {shown && !mobile && <Popup key={shown.key} position={shown.position} className="friend-quest-popup" closeButton={false} offset={[shown.slot * 13, -4]} minWidth={230} maxWidth={280}
      autoPanPaddingTopLeft={[16, 96]} autoPanPaddingBottomRight={[16, 16]}
      eventHandlers={{ remove: () => setOpen((current) => (current === shown.key ? null : current)) }}>
      <FriendQuestCard point={shown} onClose={() => setOpen(null)} />
    </Popup>}
    {shown && mobile && <FriendQuestWindow point={shown} onClose={() => setOpen(null)} />}
  </>
}

/** The phone's window over the map; a tap beside it or Escape closes it. */
function FriendQuestWindow({ point, onClose }: { point: FriendQuestPoint; onClose: () => void }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return createPortal(<div className="friend-quest-backdrop" onClick={onClose}>
    <div className="friend-quest-window" role="dialog" aria-modal="true" aria-label={uiText(point.questName)} onClick={(event) => event.stopPropagation()}>
      <FriendQuestCard point={point} onClose={onClose} />
    </div>
  </div>, document.body)
}

/** The window: whose quest, which one, what the friend still has to do here (this point's objective lit), and the quest's card. */
function FriendQuestCard({ point, onClose }: { point: FriendQuestPoint; onClose: () => void }) {
  return <div className="friend-quest-card" style={{ '--friend': point.color } as React.CSSProperties}>
    <button type="button" className="friend-quest-card-close" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={13} /></button>
    <div className="friend-quest-card-who"><i aria-hidden="true" />{point.nickname}</div>
    <div className="friend-quest-card-trader">{uiText(point.trader)}</div>
    <strong className="friend-quest-card-name">{uiText(point.questName)}</strong>
    <ul className="friend-quest-card-goals">
      {point.left.map((goal) => <li key={goal.objectiveId} className={goal.objectiveId === point.objectiveId ? 'is-here' : undefined}>{uiText(goal.text)}</li>)}
    </ul>
    <Link className="button small friend-quest-card-open" to={questCardHref({ id: point.questId, kind: point.questKind })}>{uiText('Открыть задание')}<ChevronRight size={13} /></Link>
  </div>
}
