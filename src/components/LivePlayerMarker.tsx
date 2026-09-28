import { uiText } from '../i18n/renderText'
import { useEffect, useMemo, useState } from 'react'
import { divIcon } from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'
import { canonicalMapId } from '../data/mapIds'
import type { PlayerPosition } from '../overlay/screenshotPosition'
import type { RaidState } from '../import/raidState'

/**
 * The player's position from the latest EFT screenshot on the app's own map. This is the fallback
 * for exclusive full screen, where no overlay is visible: keep the app on a second monitor.
 */
export function LivePlayerMarker({ mapId }: { mapId: string }) {
  const [position, setPosition] = useState<PlayerPosition | null>(null)
  const [raid, setRaid] = useState<RaidState>({ inRaid: false })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const desktop = window.tarkovDesktop
    if (!desktop?.experimental) return
    void desktop.experimental.getStatus().then((status) => { if (status.lastPosition) setPosition(status.lastPosition) }).catch(() => {})
    void desktop.getRaidState().then(setRaid).catch(() => {})
    const offPosition = desktop.experimental.onPosition(setPosition)
    const offRaid = desktop.onRaidStateChanged(setRaid)
    return () => { offPosition(); offRaid() }
  }, [])

  const icon = useMemo(() => divIcon({
    className: 'ov-player live-player',
    html: `<svg viewBox="0 0 40 40" style="transform:rotate(${(position?.yaw ?? 0).toFixed(1)}deg)"><circle cx="20" cy="20" r="9" /><path d="M20 3 L27 17 L20 14 L13 17 Z" /></svg>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  }), [position?.yaw])

  const onThisMap = raid.inRaid && canonicalMapId(raid.location ?? '') === mapId
  if (!position || !onThisMap || (raid.since && position.at < raid.since)) return null
  return (
    <Marker position={[position.z, position.x]} icon={icon} interactive zIndexOffset={1200}>
      <Tooltip direction="top" offset={[0, -18]}>{uiText(`Вы · ${Math.max(0, Math.round((now - position.at) / 1000))} с назад`)}</Tooltip>
    </Marker>
  )
}
