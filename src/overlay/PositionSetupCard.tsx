import { useEffect, useState } from 'react'
import { LocateFixed } from 'lucide-react'
import { startActivePolling } from '../app/activePolling'
import { uiText } from '../i18n/renderText'
import { useRemoteFeatures } from '../announcement/features'
import { POSITION_PROBLEM_TEXT, positionProblem } from './positionReadiness'
import type { ExperimentalStatus } from './types'
import './positionSetup.css'

/**
 * «Точка на карте» in one card (owner, 13.10.2026: «сделай включение точки … проще… что бы люди не настраивали 100 лет
 * ее»): what stops the dot, in plain words. The app presses no keys (owner, 14.10.2026): the player's own screenshot moves
 * the dot, so the card says which key the game takes them with. Only while something stops it (owner, 14.10.2026: the
 * «готова» card went for good).
 */
export function PositionSetupCard({ status, compact = false }: { status: ExperimentalStatus; onFixed?: () => void; compact?: boolean }) {
  const problem = positionProblem({ key: status.screenshotKey })
  if (!problem) return null
  return (
    <section className={`panel position-setup is-alert${compact ? ' is-compact' : ''}`} aria-label={uiText('Точка на карте')}>
      <div className="panel-body">
        <LocateFixed size={18} />
        <div className="position-setup-body">
          <strong>{uiText(POSITION_PROBLEM_TEXT[problem].title)}</strong>
          <p>{uiText(POSITION_PROBLEM_TEXT[problem].text)}</p>
        </div>
      </div>
    </section>
  )
}

/**
 * The same card on «Обзор» of the desktop app, only while something stops the dot: most players never open the
 * settings, and learnt it only in a raid with no dot. Never while the owner keeps the position off for everybody
 * (src/announcement/features.ts).
 */
export function PositionSetupNotice() {
  const features = useRemoteFeatures()
  const api = features.minimap ? window.tarkovDesktop?.experimental : undefined
  const [status, setStatus] = useState<ExperimentalStatus | null>(null)
  const [tracking, setTracking] = useState(false)
  useEffect(() => {
    if (!api) return
    let alive = true
    const refresh = () => void api.getStatus().then((next) => { if (alive) setStatus(next) }).catch(() => {})
    // Nothing to set up while the player turned the position off («Отключить местоположение»).
    void api.getSettings().then((settings) => { if (alive) setTracking(Boolean(settings.minimap && !settings.minimapOff)) }).catch(() => {})
    // Asked when «Обзор» opens and each time the window is used again (back from the game), never on a timer: each
    // answer may cost the main process a registry read and a search of the game's folders (src/app/activePolling.ts).
    const stop = startActivePolling(refresh)
    return () => { alive = false; stop() }
  }, [api])
  if (!api || !status || !tracking) return null
  return <PositionSetupCard status={status} compact />
}
