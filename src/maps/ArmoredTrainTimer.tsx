import { useEffect, useState } from 'react'
import { TrainFront } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { canonicalMapId } from '../data/mapIds'
import { setArmoredTrainOn, trainLine, trainSchedule, trainState, useArmoredTrainOn } from './armoredTrain'
import './armoredTrain.css'

/** «Настройки карты»: the switch of «Таймер бронепоезда», on Reserve and Lighthouse only (maps/armoredTrain.ts). */
export function ArmoredTrainSetting({ mapId }: { mapId: string }) {
  const on = useArmoredTrainOn()
  if (!trainSchedule(mapId)) return null
  const title = uiText('Таймер бронепоезда')
  return <div className="skill-timer-settings" role="group" aria-label={title}>
    <div className="map-panels-menu-title">{title}</div>
    <div className="skill-timer-row">
      <span>{uiText('Когда приедет бронепоезд')}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={title} className={`toggle ${on ? 'on' : ''}`} onClick={() => setArmoredTrainOn(!on)}><span /></button>
    </div>
  </div>
}

/**
 * Over the map, once «Таймер бронепоезда» is on: in a raid on this map (the game's logs, from «GameStarted») a countdown that
 * follows the train; otherwise when it comes after a raid's start and how long it stands.
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
  const began = shown && raid?.begun && raid.location && canonicalMapId(raid.location) === canonicalMapId(mapId) && raidRunning(raid, now) ? raid.begun : undefined
  if (!train || !on) return null
  const elapsed = began === undefined ? undefined : Math.max(0, (now - began) / 1000)
  const gone = elapsed !== undefined && trainState(train, elapsed).phase === 'gone'
  return <div className="armored-train-row">
    <div className={`armored-train${elapsed !== undefined ? ' is-live' : ''}${gone ? ' is-gone' : ''}`} role="status" aria-live="off">
      <TrainFront size={14} aria-hidden="true" />
      <span>{trainLine(train, elapsed)}</span>
    </div>
  </div>
}
