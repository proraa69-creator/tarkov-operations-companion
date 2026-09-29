import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Crosshair, LocateFixed, MonitorSmartphone, RadioTower, Server } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { MapsPage } from '../pages/MapsPage'
import { positionFreshness, useServerAccount } from '../sync/serverSync'
import type { RaidMode } from '../domain/types'
import { formatAge, LivePositionContext, useServerPositionPoll, type LivePositionValue } from './livePosition'

const LAST_MAP_KEY = 'tarkov-mobile-live-map-v1'

function readLastMap(mode: RaidMode) {
  try { return localStorage.getItem(`${LAST_MAP_KEY}-${mode}`) } catch { return null }
}
function writeLastMap(mode: RaidMode, mapId: string) {
  try { localStorage.setItem(`${LAST_MAP_KEY}-${mode}`, mapId) } catch { /* storage unavailable */ }
}

/**
 * Phone «Мини Карта»: the map the player is on right now, with his position and heading. The position is read
 * from the screenshots by the desktop app, which sends it to the server; the phone polls it (every 3 s while this
 * screen is open and the app is in the foreground). PvP, PvE and Season positions are kept apart.
 */
export function LiveMapPage() {
  const { raidMode, selectedMapId } = useAppState()
  const { data } = useTarkovData()
  const account = useServerAccount()
  const poll = useServerPositionPoll(raidMode)
  const [now, setNow] = useState(() => Date.now())
  const [follow, setFollow] = useState(true)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const freshness = positionFreshness(poll.position, now)
  const positionMap = poll.position?.map && data.maps.some((entry) => entry.id === poll.position!.map) ? poll.position.map : undefined
  useEffect(() => { if (positionMap) writeLastMap(raidMode, positionMap) }, [positionMap, raidMode])
  const lastMap = readLastMap(raidMode)
  const mapId = positionMap ?? (lastMap && data.maps.some((entry) => entry.id === lastMap) ? lastMap : selectedMapId)
  const mapName = data.maps.find((entry) => entry.id === mapId)?.name ?? ''
  const fresh = freshness.state === 'fresh'

  const live = useMemo<LivePositionValue>(() => ({ position: poll.position, fresh, follow, setFollow }), [poll.position, fresh, follow])

  const signedIn = Boolean(account.status?.signedIn)
  const online = Boolean(account.status?.online)
  let tone: 'live' | 'stale' | 'off' = 'off'
  let title: string
  let hint: string
  if (!account.available) {
    title = 'Живая позиция недоступна'
    hint = 'Позицию присылает приложение для ПК через сервер.'
  } else if (!account.status) {
    title = 'Проверяем сервер…'
    hint = ''
  } else if (!online) {
    title = 'Сервер недоступен'
    hint = 'Проверьте «Адрес сервера» в настройках: телефон и ПК должны быть в одной сети Wi-Fi.'
  } else if (!signedIn) {
    title = 'Войдите в аккаунт'
    hint = 'Войдите на телефоне в тот же аккаунт, что и в приложении для ПК.'
  } else if (fresh) {
    tone = 'live'
    title = `В рейде · ${mapName}`
    hint = `Позиция обновлена ${formatAge(freshness.ageMs ?? 0)}`
  } else {
    tone = poll.position ? 'stale' : 'off'
    title = poll.position ? 'Не в рейде · нет свежей позиции' : 'Позиции пока нет'
    hint = `${poll.position && freshness.ageMs != null ? `Последняя позиция ${formatAge(freshness.ageMs)}${mapName ? ` · ${mapName}` : ''}. ` : ''}Приложение для ПК должно быть запущено и войти в тот же аккаунт; позиция приходит со скриншотов игры.`
  }

  const banner = (
    <section className={`live-banner is-${tone}`} role="status" aria-live="polite">
      <span className="live-banner-icon">{tone === 'live' ? <RadioTower size={18} /> : tone === 'stale' ? <Crosshair size={18} /> : <MonitorSmartphone size={18} />}</span>
      <span className="live-banner-copy">
        <strong>{uiText(title)}</strong>
        {hint && <small>{uiText(hint)}</small>}
      </span>
      <span className="live-banner-actions">
        <span className="tag brass">{uiText(raidMode === 'seasonal' ? 'Сезон' : raidMode.toUpperCase())}</span>
        {(!signedIn || !online) && account.available && <Link className="button small" to="/settings"><Server size={13} />{uiText('Сервер')}</Link>}
        {fresh && positionMap === mapId && !follow && <button type="button" className="button small primary" onClick={() => setFollow(true)}><LocateFixed size={13} />{uiText('Ко мне')}</button>}
      </span>
    </section>
  )

  return (
    <LivePositionContext.Provider value={live}>
      <MapsPage key={`${raidMode}:${mapId}`} forcedMapId={mapId} liveBanner={banner} />
    </LivePositionContext.Provider>
  )
}
