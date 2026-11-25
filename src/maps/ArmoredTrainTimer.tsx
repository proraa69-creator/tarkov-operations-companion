import { useEffect, useState } from 'react'
import { TrainFront, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useRaidState } from '../app/useRaidState'
import { TOAST_MS } from '../notifications/ToastDock'
import { playTimerChime } from '../shared/uiSound'
import {
  pmcRaidBegun, setArmoredTrainNoticeOn, setArmoredTrainOn, takeTrainArrival, trainLine, trainSchedule, useArmoredTrainNoticeOn,
  useArmoredTrainOn,
} from './armoredTrain'
import './armoredTrain.css'

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return <div className="skill-timer-row">
    <span>{label}</span>
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><span /></button>
  </div>
}

/**
 * «Настройки карты», on Reserve and Lighthouse only (maps/armoredTrain.ts): «Таймер бронепоезда», the line over the map, and
 * beside it «Уведомления о прибытии» (owner, 25.11.2026).
 */
export function ArmoredTrainSetting({ mapId }: { mapId: string }) {
  const on = useArmoredTrainOn()
  const notice = useArmoredTrainNoticeOn()
  if (!trainSchedule(mapId)) return null
  const title = uiText('Таймер бронепоезда')
  return <div className="skill-timer-settings" role="group" aria-label={title}>
    <div className="map-panels-menu-title">{title}</div>
    <Switch label={title} on={on} onChange={setArmoredTrainOn} />
    <Switch label={uiText('Уведомления о прибытии')} on={notice} onChange={setArmoredTrainNoticeOn} />
  </div>
}

/**
 * Over the map, once «Таймер бронепоезда» is on. In a PMC's raid on this map (the game's logs, from «GameStarted», src/import/
 * raidState.ts `side`) the countdown to the arrival, gone once its window is over (owner, 25.11.2026: «только таймер до прибытия»).
 * Otherwise — out of a raid, a Scav's raid, a raid whose side the logs do not tell — when it comes after a raid's start and how
 * long it stands.
 */
export function ArmoredTrainBanner({ mapId }: { mapId: string }) {
  const on = useArmoredTrainOn()
  const train = trainSchedule(mapId)
  const raid = useRaidState()
  const [now, setNow] = useState(() => Date.now())
  const shown = Boolean(train && on)
  // the clock runs while the line is shown, so a raid that begins finds it current
  useEffect(() => {
    if (!shown) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [shown])
  if (!train || !on) return null
  const began = pmcRaidBegun(raid, mapId, now)
  const elapsed = began === undefined ? undefined : Math.max(0, (now - began) / 1000)
  const line = trainLine(train, elapsed)
  if (!line) return null
  return <div className="armored-train-row">
    <div className={`armored-train${elapsed !== undefined ? ' is-live' : ''}`} role="status" aria-live="off">
      <TrainFront size={14} aria-hidden="true" />
      <span>{line}</span>
    </div>
  </div>
}

/**
 * «Бронепоезд прибывает» (owner, 25.11.2026): with «Уведомления о прибытии» on, in a PMC's raid on Reserve or Lighthouse, the
 * small card of the corner dock and the chime when the train's arrival window opens — once per raid, like «Рейд начался»
 * (src/notifications/RaidStartNotifier.tsx). Not a line in «Уведомления»: the bell stays dark for it.
 */
export function ArmoredTrainNotifier() {
  const on = useArmoredTrainNoticeOn()
  const raid = useRaidState()
  const [shown, setShown] = useState(false)
  const begun = on && raid?.side === 'pmc' ? raid.begun : undefined
  const location = raid?.location
  useEffect(() => {
    const train = trainSchedule(location)
    if (begun === undefined || !train || pmcRaidBegun(raid, undefined, Date.now()) !== begun) return
    const announce = () => { if (!takeTrainArrival(begun, train)) return; playTimerChime(); setShown(true) }
    const wait = begun + train.arriveMin * 1000 - Date.now()
    if (wait <= 0) { announce(); return }
    const id = window.setTimeout(announce, wait)
    return () => window.clearTimeout(id)
  }, [begun, location]) // eslint-disable-line react-hooks/exhaustive-deps -- once per raid and map; the rest is read when it is due
  useEffect(() => {
    if (!shown) return
    const id = window.setTimeout(() => setShown(false), TOAST_MS)
    return () => window.clearTimeout(id)
  }, [shown])
  if (!shown) return null
  return (
    <div className="restock-toasts" role="status" aria-live="polite">
      <div className="restock-toast raid-start-toast armored-train-toast">
        <TrainFront size={16} aria-hidden="true" />
        <div className="quest-keys-toast-body"><strong>{uiText('Бронепоезд прибывает')}</strong></div>
        <button type="button" className="icon-button" aria-label={uiText('Закрыть')} onClick={() => setShown(false)}><X size={14} aria-hidden="true" /></button>
      </div>
    </div>
  )
}
