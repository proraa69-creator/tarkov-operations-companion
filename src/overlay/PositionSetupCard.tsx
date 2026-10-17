import { useEffect, useState, type ReactNode } from 'react'
import { LocateFixed } from 'lucide-react'
import { startActivePolling } from '../app/activePolling'
import { uiText } from '../i18n/renderText'
import { useRemoteFeatures } from '../announcement/features'
import { POSITION_PROBLEM_TEXT, positionProblem } from './positionReadiness'
import { canonicalMapId, mapDisplayName } from '../data/mapIds'
import type { ExperimentalStatus } from './types'
import './positionSetup.css'

/**
 * «Точка на карте» in one card (owner, 13.10.2026: «сделай включение точки … проще… что бы люди не настраивали 100 лет
 * ее»): what stops the dot, in plain words. The player's own screenshot moves the dot (owner, 14.10.2026). Only while
 * something stops it (owner, 14.10.2026: the «готова» card went for good).
 */
export function PositionSetupCard({ status, compact = false }: { status: ExperimentalStatus; onFixed?: () => void; compact?: boolean }) {
  const problem = positionProblem({ key: status.screenshotKey })
  // The settings also show what the app sees, step by step (only what the owner's PC can tell): «Обзор» does not.
  if (!problem) return compact ? null : <PositionDiagnostics status={status} />
  return (
    <>
      <section className={`panel position-setup is-alert${compact ? ' is-compact' : ''}`} aria-label={uiText('Точка на карте')}>
        <div className="panel-body">
          <LocateFixed size={18} />
          <div className="position-setup-body">
            <strong>{uiText(POSITION_PROBLEM_TEXT[problem].title)}</strong>
            <p>{uiText(POSITION_PROBLEM_TEXT[problem].text)}</p>
          </div>
        </div>
      </section>
      {!compact && <PositionDiagnostics status={status} />}
    </>
  )
}

const time = (at: number) => new Date(at).toLocaleTimeString()

/** One line of the check: what is looked at, what the app sees, and whether it is fine. */
function Step({ label, ok, children }: { label: string; ok: boolean | null; children: ReactNode }) {
  return (
    <li className={ok === false ? 'is-bad' : ok ? 'is-ok' : ''}>
      <span>{uiText(label)}</span> <b>{children}</b>
    </li>
  )
}

/**
 * «Проверка точки»: each link of the chain as this PC sees it — the owner's switch as the main process has it, the
 * followed folders, the newest screenshot and what its name gave, the last dot sent to «Карты», the raid's map from the
 * logs. What cannot be known anywhere but on the player's PC (which folder the game writes to, the file names it writes)
 * is shown here instead of guessed.
 */
export function PositionDiagnostics({ status }: { status: ExperimentalStatus }) {
  const seen = status.lastScreenshot
  const raidMap = status.raid.inRaid ? canonicalMapId(status.raid.location ?? '') : ''
  return (
    <details className="panel position-diagnostics">
      <summary>{uiText('Проверка точки на карте')}</summary>
      <ol className="position-diagnostics-steps">
        {status.remoteMinimap !== undefined && (
          <Step label="Местоположение у всех (переключатель владельца) в этом приложении:" ok={status.remoteMinimap}>
            {uiText(status.remoteMinimap ? 'включено' : 'выключено')}
          </Step>
        )}
        <Step label="Слежение за папкой скриншотов:" ok={status.tracking}>{uiText(status.tracking ? 'работает' : 'не работает')}</Step>
        <li>
          <span>{uiText('Папки, где приложение ждёт скриншоты игры:')}</span>
          <ul>
            {(status.watchedFolders ?? [{ folder: status.screenshotsFolder, exists: true, watching: status.tracking }]).map((entry) => (
              <li key={entry.folder} className={entry.exists ? 'is-ok' : ''}>
                <code>{entry.folder}</code> — {uiText(!entry.exists ? 'папки нет' : entry.watching ? 'есть, слежу' : 'есть, проверяю раз в секунду')}
              </li>
            ))}
          </ul>
        </li>
        <Step label="Последний новый скриншот:" ok={seen ? Boolean(seen.withCoordinates && !seen.stale) : null}>
          {!seen ? uiText('с запуска слежения не было — нажмите в рейде клавишу «Скриншот» игры') : (
            <>
              <code>{seen.name}</code> · {time(seen.at)}
              {seen.folder && <> · <code>{seen.folder}</code></>}
              {' · '}
              {!seen.withCoordinates
                ? uiText('в имени нет координат (скриншот сделан не в рейде?)')
                : seen.stale ? uiText('координаты есть, но скриншот старше 20 минут')
                  : seen.position ? `${uiText('координаты прочитаны')}: x ${seen.position.x.toFixed(1)}, z ${seen.position.z.toFixed(1)}` : uiText('координаты прочитаны')}
            </>
          )}
        </Step>
        {status.positionSentAt !== undefined && (
          <Step label="Точка отправлена на «Карты» и в телефон:" ok={status.positionSentAt ? true : null}>
            {status.positionSentAt ? time(status.positionSentAt) : uiText('ещё нет')}
          </Step>
        )}
        <Step label="Рейд по логам игры:" ok={null}>
          {!status.raid.inRaid ? uiText('не в рейде (или логи не найдены) — точка на открытой карте')
            : raidMap ? `${uiText('в рейде')}: ${uiText(mapDisplayName(raidMap))}`
              : uiText('в рейде, карта не определена — точка на открытой карте')}
        </Step>
      </ol>
    </details>
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
