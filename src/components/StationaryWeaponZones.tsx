import { Circle, Marker } from 'react-leaflet'
import { divIcon, type DivIcon, type LatLngTuple } from 'leaflet'
import type { MapMarker } from '../domain/types'
import { uiText } from '../i18n/renderText'

/**
 * Report №89 («добавьте места обстрела с пулемета или агс на картах что бы легче понимать где безопасно а где тебя могут убить»).
 * Owner, 07.11.2026: «Радиус охвата стрельбы должен быть по нажатию кнопки. То есть нажал на какой-либо станочное оружие, там
 * показывается радиус». The map data has each weapon's place but not where its barrel points, and the game publishes neither its
 * traverse nor a range: the zone is rings around the weapon every 100 m, brighter near it.
 */
export type StationaryWeaponKind = 'ags' | 'utyos'

/** tarkov.dev item ids of the two stationary weapons. */
const KIND_BY_ITEM: Record<string, StationaryWeaponKind> = {
  '5d52cc5ba4b9367408500062': 'ags',
  '5cdeb229d7f00c000e7ce174': 'utyos',
}

export const STATIONARY_WEAPONS: Record<StationaryWeaponKind, { name: string; color: string }> = {
  ags: { name: 'АГС-30', color: '#ff8a2a' },
  utyos: { name: 'Утёс', color: '#ff3b3b' },
}
/** The rings of the zone, in metres. */
export const WEAPON_ZONE_RINGS = [100, 200, 300] as const

export function stationaryWeaponKind(marker: MapMarker): StationaryWeaponKind | undefined {
  return marker.layerId === 'loot.weapon' ? KIND_BY_ITEM[marker.itemId ?? ''] : undefined
}

/** Side views drawn for the map: the grenade launcher's short thick barrel over its drum, the machine gun's long barrel. */
const SILHOUETTES: Record<StationaryWeaponKind, string> = {
  ags: `<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="currentColor" stroke="#0b0f0c" stroke-width="1.6" stroke-linejoin="round">
    <path d="M24 30 L10 44 M24 30 L38 44 M24 30 L24 44" fill="none" stroke-width="3.2" stroke-linecap="round"/>
    <rect x="10" y="17" width="20" height="10" rx="2"/><rect x="29" y="19" width="15" height="6" rx="1.5"/>
    <circle cx="19" cy="31" r="6"/><rect x="6" y="15" width="6" height="5" rx="1"/></g></svg>`,
  utyos: `<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="currentColor" stroke="#0b0f0c" stroke-width="1.6" stroke-linejoin="round">
    <path d="M18 29 L8 44 M18 29 L30 44 M18 29 L18 44" fill="none" stroke-width="3.2" stroke-linecap="round"/>
    <rect x="6" y="18" width="16" height="8" rx="2"/><rect x="21" y="20" width="25" height="3.6" rx="1.2"/>
    <rect x="40" y="18.6" width="5" height="6.4" rx="1"/><rect x="9" y="26" width="9" height="6" rx="1"/></g></svg>`,
}

const iconCache = new Map<string, DivIcon>()
/** A stationary weapon's own silhouette and name, whatever the icon style. */
export function stationaryWeaponIcon(kind: StationaryWeaponKind, focused: boolean, badge: string): DivIcon {
  const key = `${kind}|${focused ? 1 : 0}|${badge}|${uiText(STATIONARY_WEAPONS[kind].name)}`
  const cached = iconCache.get(key)
  if (cached) return cached
  const weapon = STATIONARY_WEAPONS[kind]
  const icon = divIcon({
    className: 'marker-icon',
    html: `<div class="map-marker is-stationary-weapon${focused ? ' is-focused' : ''}" style="--marker-color:${weapon.color}">${SILHOUETTES[kind]}`
      + `${badge ? `<span class="map-marker-floor">${badge}</span>` : ''}<span class="map-marker-name">${uiText(weapon.name)}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
  iconCache.set(key, icon)
  return icon
}

/** The zone of the weapon pressed on the map (`marker`, else nothing): rings every 100 m with their distance, brighter near it. */
export function StationaryWeaponZone({ marker }: { marker?: MapMarker | null }) {
  const kind = marker ? stationaryWeaponKind(marker) : undefined
  if (!marker || !kind) return null
  const { color } = STATIONARY_WEAPONS[kind]
  const center = marker.position as LatLngTuple
  const last = WEAPON_ZONE_RINGS[WEAPON_ZONE_RINGS.length - 1]
  return <>
    {WEAPON_ZONE_RINGS.map((ring) => <Circle key={`${marker.id}-${ring}`} center={center} radius={ring} interactive={false}
      pathOptions={{ color, weight: ring === last ? 1.8 : 1.2, opacity: 0.9, dashArray: ring === last ? undefined : '5 6', fillColor: color, fillOpacity: 0.1, className: 'stationary-weapon-zone' }} />)}
    {WEAPON_ZONE_RINGS.map((ring) => <Marker key={`${marker.id}-label-${ring}`} position={[center[0] + ring, center[1]]} interactive={false} keyboard={false}
      icon={divIcon({ className: 'stationary-weapon-label', html: `<span style="color:${color}">${ring} ${uiText('м')}</span>`, iconSize: [0, 0] })} />)}
  </>
}
