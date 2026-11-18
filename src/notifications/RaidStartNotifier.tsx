import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Crosshair, X } from 'lucide-react'
import { useRaidState } from '../app/useRaidState'
import { useOptionalTarkovData } from '../data/DataProvider'
import { canonicalMapId } from '../data/mapIds'
import { uiText } from '../i18n/renderText'
import { useRemoteScreen } from '../screen/screenRemote'
import { useServerStatus } from '../sync/serverSync'
import { TOAST_MS } from './ToastDock'
import { addNotification } from './notificationCenter'
import { takeRaidStart, useRaidStartNotice } from './raidStartNotice'
import { notificationOn } from './notificationKinds'
import { playTimerChime } from '../shared/uiSound'
import { rememberLastRaid } from '../overview/infoCardClock'
import '../arsenal/arsenal.css'

/**
 * «Рейд начался» (owner, 15.11.2026: «как только рейд начинается, должно всплывать уведомление в приложении… маленькое сбоку,
 * аккуратное»): the small card of the corner dock, a line in «Уведомления», and on the PC a Windows notification too (the window
 * may be behind a video; Windows' own is held back while the game is in front). Once per raid, when the raid itself begins
 * (src/import/raidState.ts `begun`), not when its loading starts. Switched off in «Настройки».
 */
/** Before the game data is there (or outside its provider): no map names, the notice still comes. */
const NO_MAPS: ReadonlyArray<{ id: string; name: string }> = []

function RaidStartToast({ mapId, onClose }: { mapId?: string; onClose: () => void }) {
  const navigate = useNavigate()
  const maps = useOptionalTarkovData()?.data.maps ?? NO_MAPS
  const map = mapId ? maps.find((entry) => entry.id === mapId) : undefined
  useEffect(() => {
    const timer = window.setTimeout(onClose, TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [onClose])
  return (
    <div className="restock-toasts" role="status" aria-live="polite">
      <div className="restock-toast raid-start-toast">
        <Crosshair size={16} aria-hidden="true" />
        <button type="button" className="quest-keys-toast-body" onClick={() => { onClose(); if (map) navigate(`/maps/${map.id}`) }}>
          <strong>{uiText('Рейд начался')}</strong>
          {map && <span>{uiText(map.name)}</span>}
        </button>
        <button type="button" className="icon-button" aria-label={uiText('Закрыть')} onClick={onClose}><X size={14} aria-hidden="true" /></button>
      </div>
    </div>
  )
}

/** The map a raid state names, as the app's map id (none for a map the app does not know). */
function raidMapId(location: string | undefined, known: ReadonlyArray<{ id: string }>): string | undefined {
  const id = location ? canonicalMapId(location) : undefined
  return id && known.some((map) => map.id === id) ? id : undefined
}

/** The PC: from the game's logs. */
export function RaidStartNotifier() {
  const on = useRaidStartNotice()
  const raid = useRaidState()
  const maps = useOptionalTarkovData()?.data.maps ?? NO_MAPS
  const [shown, setShown] = useState<{ begun: number; mapId?: string } | null>(null)
  const begun = raid?.inRaid ? raid.begun : undefined
  const mapId = raidMapId(raid?.location, maps)
  useEffect(() => {
    if (!on || !takeRaidStart(begun)) return
    const title = uiText('Рейд начался')
    const name = mapId ? uiText(maps.find((map) => map.id === mapId)?.name ?? '') : ''
    addNotification({ title, text: name, ...(mapId ? { open: `/maps/${mapId}` } : {}) })
    // the sound is the app's own chime, switched in «Уведомления» → «Настроить» (owner, 18.11.2026); Windows stays silent
    if (notificationOn('raid-start-sound')) playTimerChime()
    void window.tarkovDesktop?.notify?.(title, name, undefined, true).catch(() => false)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the card comes once, when the raid has begun
    setShown({ begun: begun!, ...(mapId ? { mapId } : {}) })
  }, [on, begun]) // eslint-disable-line react-hooks/exhaustive-deps -- once per raid; its map as known then
  if (!shown || !on) return null
  return <RaidStartToast mapId={shown.mapId} onClose={() => setShown(null)} />
}

/**
 * The PC: the raid just over, for «Таймер рейда» on the Overview («сколько длился прошлый рейд и на какой карте»). A «raid» that ends
 * within a minute of its start was an aborted loading: not kept.
 */
export function LastRaidRecorder() {
  const raid = useRaidState()
  const before = useRef(raid)
  useEffect(() => {
    const previous = before.current
    before.current = raid
    if (!previous?.inRaid || raid?.inRaid !== false) return
    const began = previous.begun ?? previous.since
    const ended = Date.now()
    if (!began || ended - began < 60_000) return
    rememberLastRaid({ began, ended, ...(previous.location ? { location: previous.location } : {}) })
  }, [raid])
  return null
}

/** The phone: what the PC app said last (its raid's start comes with its screen state, src/screen/screenRemote.ts). */
function PhoneWatcher() {
  const { pc } = useRemoteScreen()
  const maps = useOptionalTarkovData()?.data.maps ?? NO_MAPS
  const [shown, setShown] = useState<{ begun: number; mapId?: string } | null>(null)
  const begun = pc?.state.raidBegun
  const mapId = raidMapId(pc?.state.raidLocation, maps)
  useEffect(() => {
    if (!takeRaidStart(begun)) return
    const name = mapId ? uiText(maps.find((map) => map.id === mapId)?.name ?? '') : ''
    addNotification({ title: uiText('Рейд начался'), text: name, ...(mapId ? { open: `/maps/${mapId}` } : {}) })
    if (notificationOn('raid-start-sound')) playTimerChime()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the card comes once, when the raid has begun
    setShown({ begun: begun!, ...(mapId ? { mapId } : {}) })
  }, [begun]) // eslint-disable-line react-hooks/exhaustive-deps -- once per raid; its map as known then
  if (!shown) return null
  return <RaidStartToast mapId={shown.mapId} onClose={() => setShown(null)} />
}

export function PhoneRaidStartNotifier() {
  const on = useRaidStartNotice()
  const status = useServerStatus()
  // the phone hears the PC only through the account; nothing to wait for without it
  if (!on || status?.signedIn !== true) return null
  return <PhoneWatcher />
}
