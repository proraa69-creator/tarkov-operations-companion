import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Plus, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLastRaid } from '../overview/infoCardClock'
import { addDocumentsFound, DOCUMENT_DAILY_LIMIT, useDocumentDay } from '../progression/documentDailyLimit'
import { setDocumentsAfterRaid, takeRaidToAsk, useDocumentsAfterRaid } from '../progression/documentsAfterRaid'
import { useOptionalAppState } from '../state/AppState'
import './raidDocumentsPrompt.css'

/**
 * The window after a raid (owner, 27.11.2026: «по окончанию рейда вылезает окно и предлагает добавить документы, сколько их. Сколько
 * вынес за рейд, столько и добавляешь»): the battle pass documents brought out go into today's count (progression/documentDailyLimit.ts),
 * as «Нашёл» on the map and «+» in «Время в Таркове» add one. The PC only: the raid's end comes from the game's logs
 * (notifications/RaidStartNotifier.tsx LastRaidRecorder). Not with «Спрашивать после рейда» off, nor once today's limit is reached.
 */
export function RaidDocumentsPrompt() {
  const on = useDocumentsAfterRaid()
  const ended = useLastRaid()?.ended
  // the app's state of the player (outside it, as in a bare shell, nothing is asked)
  const app = useOptionalAppState()
  const profileId = app?.activeProfile.id ?? ''
  const day = useDocumentDay(profileId)
  const limit = DOCUMENT_DAILY_LIMIT[app?.raidMode ?? 'pvp']
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!on || !ended || !takeRaidToAsk(ended)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the window comes once, when a raid is over
    setAsking(true)
  }, [on, ended])
  const room = Math.max(0, limit - day.count)
  if (!app || !asking || !on || room === 0) return null
  return <RaidDocumentsDialog room={room} today={day.count} limit={limit}
    onAdd={(count) => { addDocumentsFound(profileId, count); setAsking(false) }} onClose={() => setAsking(false)} />
}

function RaidDocumentsDialog({ room, today, limit, onAdd, onClose }: { room: number; today: number; limit: number; onAdd: (count: number) => void; onClose: () => void }) {
  const [count, setCount] = useState(0)
  const titleId = useId()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="registration-overlay raid-documents-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog raid-documents-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <h2 id={titleId}>{uiText('Документы за рейд')}</h2>
        <p className="raid-documents-lead">{uiText('Сколько документов вынесли?')}</p>
        <div className="raid-documents-stepper">
          <button type="button" className="icon-button" aria-label={uiText('Документом меньше')} disabled={count <= 0} onClick={() => setCount(count - 1)}><Minus size={18} aria-hidden="true" /></button>
          <strong className="mono" aria-live="polite">{count}</strong>
          <button type="button" className="icon-button" aria-label={uiText('Документом больше')} disabled={count >= room} autoFocus onClick={() => setCount(count + 1)}><Plus size={18} aria-hidden="true" /></button>
        </div>
        <p className="raid-documents-today">{uiText('Найдено сегодня')}: <b>{today + count} {uiText('из')} {limit}</b></p>
        <div className="raid-documents-actions">
          <button type="button" className="button ghost" onClick={onClose}>{uiText('Пропустить')}</button>
          <button type="button" className="button primary" disabled={!count} onClick={() => onAdd(count)}>{uiText('Добавить')}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

/** «Настройки карты» (the PC: only it knows when a raid is over): «Документы боевого пропуска» → «Спрашивать после рейда». */
export function DocumentsAfterRaidSetting() {
  const on = useDocumentsAfterRaid()
  if (!window.tarkovDesktop) return null
  const title = uiText('Документы боевого пропуска')
  const label = uiText('Спрашивать после рейда')
  return <div className="skill-timer-settings" role="group" aria-label={title}>
    <div className="map-panels-menu-title">{title}</div>
    <div className="skill-timer-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => setDocumentsAfterRaid(!on)}><span /></button>
    </div>
  </div>
}
