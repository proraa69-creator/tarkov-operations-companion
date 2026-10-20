import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useRemoteFeatures } from '../announcement/features'
import { useTarkovData } from '../data/DataProvider'
import { canonicalMapId } from '../data/mapIds'
import type { RaidState } from '../import/raidState'
import { useLiveFeed } from '../mobile/livePosition'
import type { RaidMode } from '../domain/types'
import { useAppState } from '../state/AppState'

/** A replayed screenshot from before the window opened is no new screenshot (electron/experimental/positionTracker.ts). */
const REPLAY_SLACK_MS = 5_000

const onMapsPage = (path: string) => path === '/maps' || path.startsWith('/maps/')

/**
 * A new game screenshot opens «Карты» from any page, on the raid's map (owner, 20.10.2026: «у меня открыт обзор или
 * квесты, я нажимаю на скриншот, и у меня открывается автоматически карта, на которой я сейчас нахожусь, с правильным
 * местоположением»). On «Карты» itself the page follows the raid (components/LivePlayerMarker.tsx useFollowRaidMap,
 * mobile/PhoneMapsPage.tsx). Desktop: the screenshot itself, during a raid; phone: each new position the PC sends.
 */
export function useOpenMapOnScreenshot(mobile: boolean, raidMode: RaidMode) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { data } = useTarkovData()
  const { setSelectedMapId } = useAppState()
  const features = useRemoteFeatures()
  const latest = useRef({ pathname, maps: data.maps, navigate, setSelectedMapId, minimap: features.minimap })
  useEffect(() => { latest.current = { pathname, maps: data.maps, navigate, setSelectedMapId, minimap: features.minimap } })

  const open = (mapId: string) => {
    const { pathname: path, maps, navigate: go, setSelectedMapId: select } = latest.current
    if (onMapsPage(path)) return
    const known = mapId && maps.some((map) => map.id === mapId) ? mapId : ''
    if (known) select(known)
    go(known ? `/maps/${known}` : '/maps')
  }
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open })

  // Desktop: the screenshot as it arrives.
  useEffect(() => {
    const desktop = typeof window === 'undefined' ? undefined : window.tarkovDesktop
    if (mobile || !desktop?.experimental?.onPosition) return
    const openedAt = Date.now()
    let raid: RaidState = { inRaid: false }
    let handledAt = 0
    void desktop.getRaidState?.().then((next) => { raid = next }).catch(() => {})
    const offRaid = desktop.onRaidStateChanged?.((next) => { raid = next })
    const offPosition = desktop.experimental.onPosition((position) => {
      if (!position || position.at <= handledAt || position.at < openedAt - REPLAY_SLACK_MS || !latest.current.minimap) return
      // Between raids a screenshot is no position (owner, 18.10.2026: «только если идёт рейд»).
      if (raid.tracked && !raid.inRaid) return
      handledAt = position.at
      // The raid as the main process reads it now: the line naming the map comes after the raid start, and a main
      // process from before 0.6.0.83 did not send it on (owner, 20.10.2026: Factory opened as Customs).
      const fresh = desktop.getRaidState ? desktop.getRaidState().catch(() => raid) : Promise.resolve(raid)
      void fresh.then((now) => {
        raid = now
        if (now.tracked && !now.inRaid) return
        openRef.current(now.inRaid ? canonicalMapId(now.location ?? '') : '')
      })
    })
    return () => { offPosition(); offRaid?.() }
  }, [mobile])

  // Phone: a position the PC sent after the feed of this mode first answered (what it held then came before).
  const feed = useLiveFeed(raidMode)
  const seen = useRef<{ mode: RaidMode; at: number } | null>(null)
  useEffect(() => {
    if (!mobile || feed.loading) return
    const at = feed.position?.at ?? 0
    if (seen.current?.mode !== raidMode) { seen.current = { mode: raidMode, at }; return }
    if (!feed.position || at <= seen.current.at) return
    seen.current = { mode: raidMode, at }
    openRef.current(feed.position.map ?? '')
  }, [mobile, raidMode, feed.loading, feed.position])
}
