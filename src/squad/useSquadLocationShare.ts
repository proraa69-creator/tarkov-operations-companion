import { useEffect } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { canonicalMapId } from '../data/mapIds'
import type { RaidMode } from '../domain/types'
import type { PlayerPosition } from '../overlay/screenshotPosition'
import { createPositionThrottle } from '../sync/serverSync'
import { squadLivePath } from './squadLive'
import { useSquadSettings } from './squadSettings'
import { useSquad } from './useSquad'

const MAP_ID = /^[A-Za-z0-9_-]{1,40}$/

/** A screenshot position the server takes (server/src/routes/live.ts livePositionSchema). */
export function sendablePosition(position: PlayerPosition) {
  return [position.x, position.y, position.z, position.yaw, position.at].every((value) => typeof value === 'number' && Number.isFinite(value))
    && Math.abs(position.x) <= 100_000 && Math.abs(position.y) <= 100_000 && Math.abs(position.z) <= 100_000 && Math.abs(position.yaw) <= 3600 && position.at > 0
}

/**
 * «Местоположение тиммейтов» (owner, 14.11.2026: «каждый из них при нажатии кнопки скриншота появляется у своих тиммейтов на карте»):
 * the PC sends each screenshot's position to its squad while «Настройки отряда» has «Местоположение» on. Only during a raid whose
 * map the game's logs name, so the mates see it on the right map; never outside a raid.
 */
export function useSquadLocationShare(mode: RaidMode) {
  const { location } = useSquadSettings()
  const squad = useSquad(mode, { poll: false })
  const squadId = squad.mine?.access ? squad.mine.squad?.id ?? '' : ''
  useEffect(() => {
    const desktop = window.tarkovDesktop
    if (!location || !squadId || !desktop?.experimental?.onPosition) return
    let map = ''
    const noteRaid = (raid: { inRaid: boolean; location?: string } | undefined) => {
      const id = raid?.inRaid ? canonicalMapId(raid.location ?? '') : ''
      map = MAP_ID.test(id) ? id : ''
    }
    void desktop.getRaidState?.().then(noteRaid).catch(() => {})
    const offRaid = desktop.onRaidStateChanged?.(noteRaid)
    const throttle = createPositionThrottle((position) => {
      if (!map) return
      void serviceClient()?.('POST', `${squadLivePath(squadId, mode)}/position`, {
        x: position.x, y: position.y, z: position.z, yaw: position.yaw, at: Math.round(position.at), map,
      }).catch(() => {})
    })
    const offPosition = desktop.experimental.onPosition((position) => {
      if (!position || !sendablePosition(position)) return
      // The raid's map may come with this very screenshot: ask, then send.
      void Promise.resolve(desktop.getRaidState?.()).then(noteRaid).catch(() => {}).finally(() => throttle.push(position))
    })
    return () => { throttle.cancel(); offPosition(); offRaid?.() }
  }, [location, squadId, mode])
}
