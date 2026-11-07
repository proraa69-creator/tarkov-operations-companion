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

/**
 * Top views drawn for the map, the barrel up (owner, 07.11.2026: «Нарисуй вид сверху»): the grenade launcher with its three splayed legs, the
 * squat receiver, a short thick barrel and the grenade drum at its side; the machine gun with its long barrel and muzzle brake, the belt
 * box, the spade grips at the back. A disc of the weapon's colour under each tells them apart at a glance.
 */
const SILHOUETTES: Record<StationaryWeaponKind, string> = {
  ags: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="25" r="21" fill="currentColor" opacity=".22"/>
<g stroke="#0b0f0c" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">
<path d="M24 27L8 42M24 27l16 15M24 27V9" stroke="#0b0f0c" stroke-width="5"/><path d="M24 27L8 42M24 27l16 15M24 27V9" stroke="#4f5a2c" stroke-width="3"/>
<circle cx="8" cy="42" r="2.2" fill="#4f5a2c"/><circle cx="40" cy="42" r="2.2" fill="#4f5a2c"/>
<rect x="21" y="4" width="6" height="16" rx="1.5" fill="#3a3f3b"/><rect x="20" y="3" width="8" height="4" rx="1.2" fill="#727a74"/>
<rect x="15.5" y="17" width="17" height="15" rx="3" fill="#3a3f3b"/><rect x="18" y="19.5" width="12" height="3" rx="1" fill="#727a74" stroke="none"/>
<circle cx="36.5" cy="24.5" r="6.5" fill="#4f5a2c"/><circle cx="36.5" cy="24.5" r="3.6" fill="#7c8a46"/><circle cx="36.5" cy="24.5" r="1.3" fill="#0b0f0c" stroke="none"/>
<rect x="10.5" y="18.5" width="5" height="8" rx="1.2" fill="#3a3f3b"/><circle cx="13" cy="20.5" r="1.3" fill="#9fd3ff" stroke="none"/>
<path d="M19 32v5M29 32v5" stroke="#0b0f0c" stroke-width="3.6"/><path d="M19 32v5M29 32v5" stroke="#727a74" stroke-width="1.8"/>
</g></svg>`,
  utyos: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="26" r="21" fill="currentColor" opacity=".22"/>
<g stroke="#0b0f0c" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">
<path d="M24 34L7 45M24 34l17 11M24 30v-9" stroke="#0b0f0c" stroke-width="5"/><path d="M24 34L7 45M24 34l17 11M24 30v-9" stroke="#4f5a2c" stroke-width="3"/>
<circle cx="7" cy="45" r="2" fill="#4f5a2c"/><circle cx="41" cy="45" r="2" fill="#4f5a2c"/>
<rect x="22.4" y="5" width="3.2" height="22" rx="1" fill="#3a3f3b"/><rect x="21" y="1.5" width="6" height="5.5" rx="1.2" fill="#727a74"/><path d="M21 4.2h6" stroke="#0b0f0c" stroke-width="1"/>
<rect x="19" y="24" width="10" height="14" rx="2" fill="#3a3f3b"/><rect x="21" y="26" width="6" height="2.6" rx="1" fill="#727a74" stroke="none"/>
<rect x="9.5" y="25" width="9" height="10" rx="1.5" fill="#556b2f"/><path d="M11.5 28h5M11.5 31h5" stroke="#0b0f0c" stroke-width="1"/><path d="M18.5 28h1.5" stroke="#727a74" stroke-width="2"/>
<path d="M20 39.5h8" stroke="#0b0f0c" stroke-width="4"/><path d="M20 39.5h8" stroke="#727a74" stroke-width="2"/><path d="M21 38v4M27 38v4" stroke="#0b0f0c" stroke-width="2.4"/>
<rect x="29.5" y="25.5" width="3" height="5" rx="1" fill="#3a3f3b"/>
</g></svg>`,
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
