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
 * Top views drawn for the map, the barrel up (owner, 08.11.2026: «нарисуй картинки АГС и утеса, реалистичные, прям, настоящие»):
 * shaded steel and olive paint, round barrels, the AGS-30 with its grenade drum and PAG-17 sight, the «Утёс» with its long barrel,
 * muzzle brake, gas tube and belt box, both on tubular tripod legs with feet, a soft shadow under them. A faint disc of the weapon's
 * colour under each tells them apart at a glance. Each picture has its own gradient ids (`a…`, `u…`), so both can stand on one map.
 */
const SILHOUETTES: Record<StationaryWeaponKind, string> = {
  ags: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs>
<linearGradient id="av" x1="0" x2="1"><stop offset="0" stop-color="#16191a"/><stop offset=".35" stop-color="#7c8486"/><stop offset=".55" stop-color="#4a5052"/><stop offset="1" stop-color="#15181a"/></linearGradient>
<linearGradient id="ah" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16191a"/><stop offset=".35" stop-color="#7c8486"/><stop offset=".55" stop-color="#4a5052"/><stop offset="1" stop-color="#15181a"/></linearGradient>
<linearGradient id="abody" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#5d6466"/><stop offset=".45" stop-color="#3a3f41"/><stop offset="1" stop-color="#1d2022"/></linearGradient>
<linearGradient id="aolive" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#7d8a4a"/><stop offset=".5" stop-color="#55602f"/><stop offset="1" stop-color="#363d1d"/></linearGradient>
<linearGradient id="aleg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6f7a40"/><stop offset=".5" stop-color="#4a5428"/><stop offset="1" stop-color="#2b3116"/></linearGradient>
<radialGradient id="adrum" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#8e9b57"/><stop offset=".6" stop-color="#55602f"/><stop offset="1" stop-color="#2c3317"/></radialGradient>
<radialGradient id="alens" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#d9f1ff"/><stop offset=".5" stop-color="#4b8db8"/><stop offset="1" stop-color="#14324a"/></radialGradient>
<radialGradient id="ashadow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="33" cy="40" rx="27" ry="21" fill="url(#ashadow)"/><circle cx="32" cy="36" r="27" fill="currentColor" opacity=".18"/>
<line x1="32" y1="40" x2="9" y2="58" stroke="#0b0d0e" stroke-width="5.2" stroke-linecap="round"/><line x1="32" y1="40" x2="9" y2="58" stroke="url(#aleg)" stroke-width="3.4" stroke-linecap="round"/><line x1="32" y1="40" x2="9" y2="58" stroke="#a3ad6c" stroke-width=".8" stroke-linecap="round" opacity=".55" transform="translate(-.6 -.6)"/><circle cx="9" cy="58" r="3.2" fill="#2b3116" stroke="#0b0d0e" stroke-width="1"/><circle cx="8.2" cy="57.2" r="1.2" fill="#7d8a4a"/><line x1="32" y1="40" x2="55" y2="58" stroke="#0b0d0e" stroke-width="5.2" stroke-linecap="round"/><line x1="32" y1="40" x2="55" y2="58" stroke="url(#aleg)" stroke-width="3.4" stroke-linecap="round"/><line x1="32" y1="40" x2="55" y2="58" stroke="#a3ad6c" stroke-width=".8" stroke-linecap="round" opacity=".55" transform="translate(-.6 -.6)"/><circle cx="55" cy="58" r="3.2" fill="#2b3116" stroke="#0b0d0e" stroke-width="1"/><circle cx="54.2" cy="57.2" r="1.2" fill="#7d8a4a"/><line x1="32" y1="36" x2="32" y2="14" stroke="#0b0d0e" stroke-width="5.2" stroke-linecap="round"/><line x1="32" y1="36" x2="32" y2="14" stroke="url(#aleg)" stroke-width="3.4" stroke-linecap="round"/><line x1="32" y1="36" x2="32" y2="14" stroke="#a3ad6c" stroke-width=".8" stroke-linecap="round" opacity=".55" transform="translate(-.6 -.6)"/><circle cx="32" cy="14" r="3.2" fill="#2b3116" stroke="#0b0d0e" stroke-width="1"/><circle cx="31.2" cy="13.2" r="1.2" fill="#7d8a4a"/>
<circle cx="32" cy="40" r="5" fill="url(#aolive)" stroke="#0b0d0e" stroke-width="1"/>
<rect x="27.5" y="6" width="9" height="22" rx="2" fill="url(#av)" stroke="#0b0d0e" stroke-width="1"/>
<path d="M27.8 12h8.4M27.8 15h8.4M27.8 18h8.4M27.8 21h8.4" stroke="#0e1012" stroke-width=".9" opacity=".8"/>
<rect x="26.5" y="3.5" width="11" height="5" rx="1.6" fill="url(#av)" stroke="#0b0d0e" stroke-width="1"/><ellipse cx="32" cy="4.2" rx="3" ry="1" fill="#050607"/>
<rect x="21" y="24" width="22" height="20" rx="3" fill="url(#abody)" stroke="#0b0d0e" stroke-width="1.1"/>
<rect x="24" y="26.5" width="16" height="4.5" rx="1.2" fill="#5f676a" stroke="#0b0d0e" stroke-width=".6"/><path d="M24 34h16M24 38.5h16" stroke="#0e1012" stroke-width=".7"/>
<circle cx="23.6" cy="41.4" r=".8" fill="#9aa2a5"/><circle cx="40.4" cy="41.4" r=".8" fill="#9aa2a5"/><circle cx="23.6" cy="26.6" r=".8" fill="#9aa2a5"/><circle cx="40.4" cy="26.6" r=".8" fill="#9aa2a5"/>
<circle cx="51" cy="33" r="9.5" fill="url(#adrum)" stroke="#0b0d0e" stroke-width="1.1"/>
<g stroke="#2a3015" stroke-width=".9" opacity=".9"><path d="M51 24.2v4.2M51 37.6v4.2M42.2 33h4.2M55.6 33h4.2M44.8 26.8l3 3M54.2 36.2l3 3M57.2 26.8l-3 3M47.8 36.2l-3 3"/></g>
<circle cx="51" cy="33" r="3.6" fill="#3d4520" stroke="#0b0d0e" stroke-width=".8"/><circle cx="50.2" cy="32.2" r="1.2" fill="#9aa86a"/>
<path d="M42.6 30.5h3.6v5h-3.6z" fill="#3a3f41" stroke="#0b0d0e" stroke-width=".7"/>
<rect x="11" y="26" width="10" height="11" rx="2" fill="url(#abody)" stroke="#0b0d0e" stroke-width="1"/><rect x="12.5" y="21.5" width="7" height="6" rx="1.5" fill="#2a2e30" stroke="#0b0d0e" stroke-width=".8"/>
<circle cx="16" cy="24.5" r="2.4" fill="url(#alens)"/><circle cx="15.2" cy="23.7" r=".7" fill="#fff" opacity=".9"/>
<path d="M27 44v6.5M37 44v6.5" stroke="#0b0d0e" stroke-width="4" stroke-linecap="round"/><path d="M27 44v6.5M37 44v6.5" stroke="url(#ah)" stroke-width="2.4" stroke-linecap="round"/>
</svg>`,
  utyos: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs>
<linearGradient id="uv" x1="0" x2="1"><stop offset="0" stop-color="#16191a"/><stop offset=".35" stop-color="#7c8486"/><stop offset=".55" stop-color="#4a5052"/><stop offset="1" stop-color="#15181a"/></linearGradient>
<linearGradient id="uh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16191a"/><stop offset=".35" stop-color="#7c8486"/><stop offset=".55" stop-color="#4a5052"/><stop offset="1" stop-color="#15181a"/></linearGradient>
<linearGradient id="ubody" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#5d6466"/><stop offset=".45" stop-color="#3a3f41"/><stop offset="1" stop-color="#1d2022"/></linearGradient>
<linearGradient id="uolive" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#7d8a4a"/><stop offset=".5" stop-color="#55602f"/><stop offset="1" stop-color="#363d1d"/></linearGradient>
<linearGradient id="uleg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6f7a40"/><stop offset=".5" stop-color="#4a5428"/><stop offset="1" stop-color="#2b3116"/></linearGradient>
<radialGradient id="udrum" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#8e9b57"/><stop offset=".6" stop-color="#55602f"/><stop offset="1" stop-color="#2c3317"/></radialGradient>
<radialGradient id="ulens" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#d9f1ff"/><stop offset=".5" stop-color="#4b8db8"/><stop offset="1" stop-color="#14324a"/></radialGradient>
<radialGradient id="ushadow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="33" cy="42" rx="27" ry="20" fill="url(#ushadow)"/><circle cx="32" cy="38" r="27" fill="currentColor" opacity=".18"/>
<line x1="32" y1="46" x2="7" y2="61" stroke="#0b0d0e" stroke-width="5.2" stroke-linecap="round"/><line x1="32" y1="46" x2="7" y2="61" stroke="url(#uleg)" stroke-width="3.4" stroke-linecap="round"/><line x1="32" y1="46" x2="7" y2="61" stroke="#a3ad6c" stroke-width=".8" stroke-linecap="round" opacity=".55" transform="translate(-.6 -.6)"/><circle cx="7" cy="61" r="3.2" fill="#2b3116" stroke="#0b0d0e" stroke-width="1"/><circle cx="6.2" cy="60.2" r="1.2" fill="#7d8a4a"/><line x1="32" y1="46" x2="57" y2="61" stroke="#0b0d0e" stroke-width="5.2" stroke-linecap="round"/><line x1="32" y1="46" x2="57" y2="61" stroke="url(#uleg)" stroke-width="3.4" stroke-linecap="round"/><line x1="32" y1="46" x2="57" y2="61" stroke="#a3ad6c" stroke-width=".8" stroke-linecap="round" opacity=".55" transform="translate(-.6 -.6)"/><circle cx="57" cy="61" r="3.2" fill="#2b3116" stroke="#0b0d0e" stroke-width="1"/><circle cx="56.2" cy="60.2" r="1.2" fill="#7d8a4a"/><line x1="32" y1="44" x2="32" y2="30" stroke="#0b0d0e" stroke-width="5.2" stroke-linecap="round"/><line x1="32" y1="44" x2="32" y2="30" stroke="url(#uleg)" stroke-width="3.4" stroke-linecap="round"/><line x1="32" y1="44" x2="32" y2="30" stroke="#a3ad6c" stroke-width=".8" stroke-linecap="round" opacity=".55" transform="translate(-.6 -.6)"/><circle cx="32" cy="30" r="3.2" fill="#2b3116" stroke="#0b0d0e" stroke-width="1"/><circle cx="31.2" cy="29.2" r="1.2" fill="#7d8a4a"/>
<circle cx="32" cy="46" r="4.5" fill="url(#uolive)" stroke="#0b0d0e" stroke-width="1"/>
<rect x="30" y="6" width="4" height="34" rx="1.2" fill="url(#uv)" stroke="#0b0d0e" stroke-width=".9"/>
<rect x="34.6" y="17" width="2.2" height="20" rx="1" fill="url(#uv)" stroke="#0b0d0e" stroke-width=".7"/>
<path d="M30 22h6.8M30 28h6.8" stroke="#0b0d0e" stroke-width="1.4"/>
<rect x="28" y="1.5" width="8" height="7.5" rx="1.4" fill="url(#uv)" stroke="#0b0d0e" stroke-width="1"/><path d="M28.4 3.8h7.2M28.4 6.2h7.2" stroke="#050607" stroke-width="1.1"/>
<rect x="25.5" y="36" width="13" height="16" rx="2" fill="url(#ubody)" stroke="#0b0d0e" stroke-width="1.1"/>
<rect x="27.5" y="38" width="9" height="7" rx="1" fill="#5f676a" stroke="#0b0d0e" stroke-width=".6"/><path d="M27.5 47.5h9" stroke="#0e1012" stroke-width=".8"/>
<circle cx="27.2" cy="50.3" r=".7" fill="#9aa2a5"/><circle cx="36.8" cy="50.3" r=".7" fill="#9aa2a5"/>
<rect x="31" y="35" width="2" height="3.4" rx=".5" fill="#2a2e30" stroke="#0b0d0e" stroke-width=".5"/>
<rect x="10" y="37" width="13" height="12" rx="1.6" fill="url(#uolive)" stroke="#0b0d0e" stroke-width="1"/>
<path d="M12 39.5h9M12 46.5h9" stroke="#2a3015" stroke-width=".9"/><rect x="14.5" y="41.6" width="4" height="2.6" rx="1" fill="#2a3015"/>
<path d="M23 41h2.6M23 43h2.6M23 45h2.6" stroke="#c9a227" stroke-width="1.3"/>
<path d="M26 53.5h12" stroke="#0b0d0e" stroke-width="4" stroke-linecap="round"/><path d="M26 53.5h12" stroke="url(#uh)" stroke-width="2.4" stroke-linecap="round"/>
<path d="M27 52v5.5M37 52v5.5" stroke="#0b0d0e" stroke-width="3" stroke-linecap="round"/><path d="M27 52v5.5M37 52v5.5" stroke="#3a3f41" stroke-width="1.6" stroke-linecap="round"/>
</svg>`,
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
