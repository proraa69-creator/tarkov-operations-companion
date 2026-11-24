import { useEffect, useMemo } from 'react'
import { Marker, Tooltip, useMap } from 'react-leaflet'
import { divIcon, latLngBounds } from 'leaflet'
import type { MapMarker } from '../domain/types'
import { uiText } from '../i18n/renderText'
import './locationKeys.css'

const GLOW = divIcon({ className: 'key-door-glow', iconSize: [34, 34], iconAnchor: [17, 17] })

/**
 * The doors a key opens, lit on the map (report 186: «показывает, какую дверь он открывает… Если несколько дверей открывает,
 * как ключ от завода, то он подсвечивает все двери»): a pulsing ring at each, and the map shows them all at once — or flies
 * to `door` when one was picked. Floors are named on the ring of a door off the floor on screen.
 */
export function KeyDoorsGlow({ doors, door, floor, keyName }: { doors: readonly MapMarker[]; door?: string | null; floor?: string; keyName?: string }) {
  const map = useMap()
  const signature = doors.map((entry) => entry.id).join('|')
  const target = useMemo(() => (door ? doors.find((entry) => entry.id === door) : undefined), [door, doors])
  useEffect(() => {
    if (!doors.length) return
    if (target || doors.length === 1) {
      const one = target ?? doors[0]!
      map.flyTo(one.position, Math.min(Math.max(map.getZoom(), map.getMinZoom() + 3), map.getMaxZoom()), { duration: 0.55 })
      return
    }
    map.flyToBounds(latLngBounds(doors.map((entry) => entry.position)), { padding: [70, 70], duration: 0.6, maxZoom: map.getMaxZoom() - 1 })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per key and per picked door, not on every rebuilt marker
  }, [map, signature, target?.id])
  return <>{doors.map((entry) => <Marker key={entry.id} position={entry.position} icon={GLOW} interactive={false} keyboard={false} zIndexOffset={2000}>
    {(entry.floor && entry.floor !== floor) || entry.id === target?.id
      ? <Tooltip permanent direction="top" offset={[0, -16]} className="key-door-glow-label">{[keyName, entry.floor && entry.floor !== floor ? uiText(entry.floor) : ''].filter(Boolean).join(' · ')}</Tooltip>
      : null}
  </Marker>)}</>
}
