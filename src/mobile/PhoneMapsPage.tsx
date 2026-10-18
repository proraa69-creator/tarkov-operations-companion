import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { MapsPage } from '../pages/MapsPage'
import { positionFreshness, POSITION_FRESH_MS } from '../sync/serverSync'
import { LivePositionContext, useLiveFeed, type LivePositionValue } from './livePosition'

/** How often the freshness of the last position is looked at again (a position turns stale after 3 minutes). */
const FRESHNESS_TICK_MS = 5_000

/**
 * Phone «Карты» with the player's position (owner, 13.10.2026: «в нижнем меню убери раздел миникарта. при нажатии на
 * миникарту в игре, точка появляется на основной карте в приложении»). The desktop app reads the position from each
 * game screenshot and sends it to the server; this page polls it like the removed «Мини Карта» screen did. A new
 * position opens the map the player is on and centres it on him once; any other map can be looked at in between.
 * PvP, PvE and Season positions stay apart (the poll follows the mode switch).
 */
export function PhoneMapsPage() {
  const { raidMode, selectedMapId, setSelectedMapId } = useAppState()
  const { data } = useTarkovData()
  const { mapId: routeMapId } = useParams()
  const navigate = useNavigate()
  // The feed itself runs for the whole app (AppShell LiveFeedRunner): the dot is there the moment this page opens.
  const poll = useLiveFeed(raidMode)
  const [now, setNow] = useState(() => Date.now())
  /** The position whose following the player stopped by dragging the map; a newer one is followed again. */
  const [draggedAt, setDraggedAt] = useState<number | null>(null)
  const handledAt = useRef<number | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), FRESHNESS_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  const position = poll.position
  // A position whose map the PC could not name is fresh as well: it goes on the open map (LivePlayerMarker useLivePlayer),
  // as on the PC — before, such a position never showed on the phone (owner, 18.10.2026).
  const freshness = positionFreshness(position, now)
  const fresh = freshness.state === 'fresh' || (freshness.state === 'no-map' && freshness.ageMs <= POSITION_FRESH_MS)
  const shownMapId = routeMapId ?? selectedMapId
  const follow = Boolean(position && fresh && draggedAt !== position.at)
  const setFollow = useCallback((value: boolean) => setDraggedAt(value ? null : position?.at ?? null), [position?.at])

  // A position the page has not acted on yet opens the player's map (the marker follows him until the map is dragged).
  useEffect(() => {
    if (!position || !fresh || !position.map || handledAt.current === position.at) return
    handledAt.current = position.at
    if (!data.maps.some((map) => map.id === position.map) || position.map === shownMapId) return
    setSelectedMapId(position.map)
    navigate(`/maps/${position.map}`, { replace: true })
  }, [data.maps, fresh, navigate, position, setSelectedMapId, shownMapId])

  const live = useMemo<LivePositionValue>(() => ({ position, fresh, follow, setFollow }), [position, fresh, follow, setFollow])
  return (
    <LivePositionContext.Provider value={live}>
      <MapsPage />
    </LivePositionContext.Provider>
  )
}
