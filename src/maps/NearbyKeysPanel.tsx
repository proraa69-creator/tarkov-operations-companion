import { useState } from 'react'
import { ChevronDown, ChevronUp, KeyRound, MapPin, X } from 'lucide-react'
import { Marker } from 'react-leaflet'
import { divIcon } from 'leaflet'
import type { Item, MapMarker } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { setNearbyKeysOn, useNearbyKeysOn, type NearbyKey } from './nearbyKeys'
import { setNeededSpawnsOnly, useNeededSpawnsOnly } from './neededSpawns'
import './nearbyKeys.css'

const GLOW = divIcon({ className: 'key-door-glow nearby-key-glow', iconSize: [34, 34], iconAnchor: [17, 17] })

/** The spawns of «Ключи рядом» lit on the map, without moving it (the player looks at his own place in the raid). */
export function NearbyKeysGlow({ spots }: { spots: readonly MapMarker[] }) {
  return <>{spots.map((spot) => <Marker key={spot.id} position={spot.position} icon={GLOW} interactive={false} keyboard={false} zIndexOffset={1900} />)}</>
}

/**
 * «Ключи рядом» at the bottom of the map in a raid (src/maps/nearbyKeys.ts): the keys, each with its quest, a pin to its nearest
 * spawn, «Свернуть» (the spawns stay on the map) and «Закрыть» (they go, for this raid).
 */
export function NearbyKeysPanel({ keys, items, onShow, onClose }: { keys: readonly NearbyKey[]; items: ReadonlyMap<string, Item>; onShow: (spot: MapMarker) => void; onClose: () => void }) {
  const [folded, setFolded] = useState(false)
  if (!keys.length) return null
  if (folded) {
    return <button type="button" className="nearby-keys-chip" onClick={() => setFolded(false)}>
      <KeyRound size={14} aria-hidden="true" />{uiText('Ключи рядом')} · {keys.length}<ChevronUp size={14} aria-hidden="true" />
    </button>
  }
  return <section className="nearby-keys" role="status" aria-live="polite" aria-label={uiText('Ключи рядом')}>
    <header>
      <KeyRound size={15} aria-hidden="true" />
      <strong>{uiText('Рядом с вашим квестом спавн ключа — проверьте')}</strong>
      <button type="button" className="icon-button" onClick={() => setFolded(true)} aria-label={uiText('Свернуть')} title={uiText('Свернуть')}><ChevronDown size={15} /></button>
      <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={15} /></button>
    </header>
    <ul>
      {keys.map((entry) => {
        const item = items.get(entry.keyId)
        return <li key={entry.keyId}>
          <span className="nearby-keys-picture">{item?.iconUrl ? <img src={item.iconUrl} alt="" /> : <KeyRound size={16} />}</span>
          <span className="nearby-keys-text">
            <strong title={uiText(item?.name ?? entry.keyId)}>{uiText(item?.shortName || item?.name || entry.keyId)}</strong>
            <small>{entry.quests.map((quest) => uiText(quest.name)).join(', ')}</small>
          </span>
          <button type="button" className="button small" onClick={() => onShow(entry.spots[0]!)} title={uiText('Показать на карте')}>
            <MapPin size={13} aria-hidden="true" />{entry.spots.length > 1 ? entry.spots.length : uiText('Где')}
          </button>
        </li>
      })}
    </ul>
  </section>
}

/** «Настройки карты»: the switch of «Ключи рядом». */
export function NearbyKeysSetting() {
  const on = useNearbyKeysOn()
  const title = uiText('Показывать уведомления о ближайших ключах')
  return <div className="skill-timer-settings" role="group" aria-label={title}>
    <div className="map-panels-menu-title">{uiText('Ключи рядом')}</div>
    <div className="skill-timer-row">
      <span>{title}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={title} className={`toggle ${on ? 'on' : ''}`} onClick={() => setNearbyKeysOn(!on)}><span /></button>
    </div>
  </div>
}

/** «Настройки карты»: «Показывать только нужные спавны» (maps/neededSpawns.ts). */
export function NeededSpawnsSetting() {
  const on = useNeededSpawnsOnly()
  const title = uiText('Показывать только нужные спавны')
  return <div className="skill-timer-settings" role="group" aria-label={title}>
    <div className="map-panels-menu-title">{uiText('Спавны')}</div>
    <div className="skill-timer-row">
      <span>{title}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={title} className={`toggle ${on ? 'on' : ''}`} onClick={() => setNeededSpawnsOnly(!on)}><span /></button>
    </div>
  </div>
}
