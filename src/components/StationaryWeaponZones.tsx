import { Polygon } from 'react-leaflet'
import { divIcon, type DivIcon, type LatLngTuple } from 'leaflet'
import { weaponSectorAt, type WeaponSector } from '../data/stationaryWeaponSectors'
import type { MapMarker } from '../domain/types'
import { uiText } from '../i18n/renderText'

/**
 * Report №89 («добавьте места обстрела с пулемета или агс на картах что бы легче понимать где безопасно а где тебя могут убить»).
 * Owner, 07.11.2026: «Радиус охвата стрельбы должен быть по нажатию кнопки. То есть нажал на какой-либо станочное оружие, там
 * показывается радиус»; «А радиус куда он стоит, в каком направлении… Дистанцию метров 150». The zone is the weapon's sector — where it
 * points and how far it turns to each side (src/data/stationaryWeaponSectors.ts) — out to 150 m, brighter near the weapon.
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
/** How far the sector reaches, in metres (owner: «Дистанцию метров 150»). */
export const WEAPON_ZONE_METRES = 150

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

/** The sector as map points ([z, x]): the weapon, then its arc from the left limit to the right one. */
export function sectorPoints(center: LatLngTuple, sector: Pick<WeaponSector, 'heading' | 'left' | 'right'>, radius: number): LatLngTuple[] {
  const from = sector.heading - sector.left
  const span = sector.left + sector.right
  const steps = Math.max(6, Math.round(span / 4))
  const arc = Array.from({ length: steps + 1 }, (_, index) => {
    const angle = ((from + (span * index) / steps) * Math.PI) / 180
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius] as LatLngTuple
  })
  return [center, ...arc, center]
}

/** The sector of the weapon pressed on the map (`marker`, else nothing), brighter near the weapon; none while its sector is unknown. */
export function StationaryWeaponZone({ marker }: { marker?: MapMarker | null }) {
  const kind = marker ? stationaryWeaponKind(marker) : undefined
  const sector = marker && kind ? weaponSectorAt(marker.mapId, marker.position as [number, number]) : undefined
  if (!marker || !kind || !sector) return null
  const { color } = STATIONARY_WEAPONS[kind]
  const center = marker.position as LatLngTuple
  return <>
    {[1, 0.66, 0.33].map((part) => <Polygon key={`${marker.id}-${part}`} positions={sectorPoints(center, sector, WEAPON_ZONE_METRES * part)} interactive={false}
      pathOptions={{ color, weight: part === 1 ? 1.8 : 0, opacity: 0.95, fillColor: color, fillOpacity: 0.13, className: 'stationary-weapon-zone' }} />)}
  </>
}
