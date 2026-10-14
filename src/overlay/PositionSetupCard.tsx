import { useEffect, useState } from 'react'
import { LocateFixed } from 'lucide-react'
import { startActivePolling } from '../app/activePolling'
import { uiText } from '../i18n/renderText'
import { minimapOverlayAllowed, useRemoteFeatures } from '../announcement/features'
import { hotkeyForGameKeys, hotkeyLabel } from './hotkeys'
import { POSITION_PROBLEM_TEXT, positionFix, positionProblem, TRACKING_NO_KEY_TEXT } from './positionReadiness'
import type { ExperimentalStatus } from './types'
import './positionSetup.css'

/**
 * «Точка на мини-карте» in one card (owner, 13.10.2026: «сделай включение точки на миникарте проще… что бы люди не
 * настраивали 100 лет ее»): what stops the dot, in plain words, and one button for what the app can fix itself. The app
 * presses no keys (owner, 14.10.2026): the game's «Скриншот» belongs on the minimap's key, and the card says which keys
 * they are now. Only while something stops it: the «Точка на мини-карте готова» card went for good (owner, 14.10.2026:
 * «замазаное удали навсегда»). `overlay`: the owner allows the window over the game; off, only a missing «Скриншот» key
 * stops the position on the app's maps.
 */
export function PositionSetupCard({ status, onFixed, compact = false, overlay = true }: { status: ExperimentalStatus; onFixed?: () => void; compact?: boolean; overlay?: boolean }) {
  const api = window.tarkovDesktop?.experimental
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const problem = positionProblem({ native: !status.nativeError, key: status.screenshotKey, minimapKey: status.minimapKey, elevated: status.elevated, gameKeys: status.gameKeys, overlay })
  const fix = positionFix(problem, status.screenshotKey.keys, status.otherKeys)
  if (!problem) return null
  const gameKey = status.screenshotKey.unbound ? uiText('не назначен') : status.screenshotKey.label

  const run = async () => {
    if (!api || busy) return
    setBusy(true)
    setNote('')
    try {
      if (fix === 'use-game-key') {
        const code = hotkeyForGameKeys(status.screenshotKey.keys)
        if (code) {
          await api.updateSettings({ minimapKey: code })
          setNote(`${uiText('Готово: мини-карта открывается клавишей')} ${hotkeyLabel(code)} ${uiText('— той же, что делает скриншот в игре.')}`)
        }
      } else if (fix === 'admin') {
        const started = await api.relaunchAsAdmin()
        if (!started) setNote(uiText('Windows не дал права администратора — приложение работает дальше без них.'))
      }
      onFixed?.()
    } catch {
      setNote(uiText('Не получилось. Попробуйте ещё раз.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`panel position-setup is-alert${compact ? ' is-compact' : ''}`} aria-label={uiText('Точка на мини-карте')}>
      <div className="panel-body">
        <LocateFixed size={18} />
        <div className="position-setup-body">
          <strong>{uiText(POSITION_PROBLEM_TEXT[problem].title)}</strong>
          <p>{uiText(!overlay && problem === 'no-key' ? TRACKING_NO_KEY_TEXT : POSITION_PROBLEM_TEXT[problem].text)}</p>
          {overlay && (problem === 'no-key' || problem === 'other-key') && (
            <small className="position-setup-keys">{uiText('Сейчас «Скриншот» в игре:')} <kbd>{gameKey}</kbd> · {uiText('мини-карта:')} <kbd>{hotkeyLabel(status.minimapKey)}</kbd></small>
          )}
          {fix && (
            <div className="exp-actions">
              <button type="button" className="button primary" disabled={busy || !api} onClick={() => void run()}>
                {fix === 'use-game-key'
                  ? `${uiText('Открывать мини-карту клавишей')} ${status.screenshotKey.label}`
                  : uiText('Перезапустить от имени администратора')}
              </button>
            </div>
          )}
          {note && <small className="position-setup-note" role="status">{note}</small>}
        </div>
      </div>
    </section>
  )
}

/**
 * The same card on «Обзор» of the desktop app, only while something stops the dot: most players never open the Mini Map
 * page, and learnt it only in a raid with no dot. Never while the owner keeps the minimap off for everybody
 * (src/announcement/features.ts).
 */
export function PositionSetupNotice() {
  const features = useRemoteFeatures()
  const api = features.minimap ? window.tarkovDesktop?.experimental : undefined
  const [status, setStatus] = useState<ExperimentalStatus | null>(null)
  const [minimap, setMinimap] = useState(false)
  useEffect(() => {
    if (!api) return
    let alive = true
    const refresh = () => void api.getStatus().then((next) => { if (alive) setStatus(next) }).catch(() => {})
    // Nothing to set up while the player turned the minimap off («Отключить мини-карту»).
    void api.getSettings().then((settings) => { if (alive) setMinimap(Boolean(settings.minimap && !settings.minimapOff)) }).catch(() => {})
    // Asked when «Обзор» opens and each time the window is used again (back from the game), never on a timer: each
    // answer may cost the main process a registry read and a search of the game's folders (src/app/activePolling.ts).
    // The card's own button asks again itself (onFixed).
    const stop = startActivePolling(refresh)
    return () => { alive = false; stop() }
  }, [api])
  if (!api || !status || !minimap) return null
  return <PositionSetupCard status={status} compact overlay={minimapOverlayAllowed(features)} onFixed={() => void api.getStatus().then(setStatus).catch(() => {})} />
}
