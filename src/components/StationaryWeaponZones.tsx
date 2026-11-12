import { Polygon } from 'react-leaflet'
import { divIcon, type DivIcon, type LatLngTuple } from 'leaflet'
import { weaponSectorAt, type WeaponSector } from '../data/stationaryWeaponSectors'
import type { MapMarker } from '../domain/types'
import { uiText } from '../i18n/renderText'
import agsPicture from '../assets/map-markers/real/ags-30.webp'
import utyosPicture from '../assets/map-markers/real/nsv-utyos.webp'

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
 * The real weapons, cut out of photos (owner, 11.11.2026: «станковое оружие там должен быть реальная картинка АГС или утеса, просто
 * обрезанная, вставленная»), each over a faint disc of its colour that tells them apart at a glance. Kept inside an <svg>, as the
 * drawn pictures were, so the map's styles for them stay as they are. Photos from Wikimedia Commons:
 * AGS-30 — «AGS-30 maks2009» by Allocer, CC BY-SA 3.0, https://commons.wikimedia.org/wiki/File:AGS-30_maks2009.jpg;
 * NSV «Утёс» — «NSV machine gun-01» by Vitaly V. Kuzmin, CC BY-SA 3.0, https://commons.wikimedia.org/wiki/File:NSV_machine_gun-01.jpg.
 */
const picture = (url: string) => `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="34" r="27" fill="currentColor" opacity=".18"/>`
  + `<image href="${url}" x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid meet"/></svg>`
const SILHOUETTES: Record<StationaryWeaponKind, string> = {
  ags: picture(agsPicture),
  utyos: picture(utyosPicture),
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
    iconSize: [40, 40],
    iconAnchor: [20, 20],
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
