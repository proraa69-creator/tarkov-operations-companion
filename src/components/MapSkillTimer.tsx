import { useEffect, useState } from 'react'
import { Hourglass } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { SettingHelp } from './SettingHelp'
import { playTimerChime } from '../shared/uiSound'
import {
  SKILL_TIMER_MAX, SKILL_TIMER_MIN, clampTimerSeconds, formatTimerClock, isSkillTimerChime, loadTimerEndsAt, saveTimerEndsAt, saveTimerSeconds,
  setSkillTimerChime, setSkillTimerEnabled, timerSecondsLeft, useSkillTimerChime, useSkillTimerEnabled, useSkillTimerSeconds,
} from './skillTimer'
import './mapSkillTimer.css'

/** How long the button stays lit after the countdown reaches zero. No sound unless «Сигнал в конце» is on (report 177). */
const DONE_GLOW_MS = 4000

/**
 * Player report 155: a silent countdown left of «Отложенные квесты» to time a skill's fatigue reset (owner, 15.11.2026:
 * «слева от кнопки «Отложенные квесты»… значок «Песочные часы»… нажимаешь, и будет отсчёт 200 секунд»). Idle it reads
 * 0:00; a press starts it from the length picked in the gear menu, another press stops it.
 */
export function MapSkillTimer() {
  const seconds = useSkillTimerSeconds()
  const [endsAt, setEndsAt] = useState<number | null>(() => loadTimerEndsAt(Date.now()))
  const [now, setNow] = useState(() => Date.now())
  const [doneAt, setDoneAt] = useState<number | null>(null)

  useEffect(() => {
    if (endsAt === null) return
    // A slow window may run several ticks before React re-renders: the end is acted on once.
    let over = false
    const tick = () => {
      if (over) return
      const current = Date.now()
      setNow(current)
      if (current < endsAt) return
      over = true
      setEndsAt(null); saveTimerEndsAt(null); setDoneAt(current)
      // Once, as the countdown ends; a countdown that ran out while the map was closed stays silent.
      if (isSkillTimerChime()) playTimerChime()
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [endsAt])

  useEffect(() => {
    if (doneAt === null) return
    const id = window.setTimeout(() => setDoneAt(null), DONE_GLOW_MS)
    return () => window.clearTimeout(id)
  }, [doneAt])

  const running = endsAt !== null
  const toggle = () => {
    setDoneAt(null)
    if (running) { setEndsAt(null); saveTimerEndsAt(null); return }
    const start = Date.now()
    const next = start + seconds * 1000
    setNow(start)
    setEndsAt(next)
    saveTimerEndsAt(next)
  }

  const hint = running ? uiText('Нажмите — сброс') : `${uiText('Отсчёт')} ${formatTimerClock(seconds)}`
  return (
    <button type="button" className={`map-tool skill-timer-clock${running ? ' active' : ''}${doneAt !== null ? ' is-done' : ''}`}
      onClick={toggle} title={hint} aria-label={hint} aria-pressed={running}>
      <Hourglass size={14} aria-hidden="true" /><span>{formatTimerClock(timerSecondsLeft(endsAt, now))}</span>
    </button>
  )
}

/** The gear menu over the locations: the timer on or off and its length, 200 s by default (owner, 15.11.2026). */
export function MapSkillTimerSettings() {
  const enabled = useSkillTimerEnabled()
  const chime = useSkillTimerChime()
  const seconds = useSkillTimerSeconds()
  const [draft, setDraft] = useState(String(seconds))
  // Another window changed the length: show it (state adjusted during render, not in an effect).
  const [shown, setShown] = useState(seconds)
  if (shown !== seconds) { setShown(seconds); setDraft(String(seconds)) }
  const commit = () => { const next = clampTimerSeconds(draft); saveTimerSeconds(next); setDraft(String(next)) }
  const title = uiText('Таймер усталости')
  return (
    <div className="skill-timer-settings" role="group" aria-label={title}>
      <div className="map-panels-menu-title">{title}<SettingHelp id="skillTimer" /></div>
      <div className="skill-timer-row">
        <span>{uiText('На карте')}</span>
        <button type="button" role="switch" aria-checked={enabled} aria-label={title} className={`toggle ${enabled ? 'on' : ''}`}
          onClick={() => setSkillTimerEnabled(!enabled)}>
          <span />
        </button>
      </div>
      <div className="skill-timer-row">
        <span>{uiText('Сигнал в конце')}</span>
        {/* Turned on, it plays once so the player hears how quiet it is. */}
        <button type="button" role="switch" aria-checked={chime} aria-label={uiText('Сигнал в конце')} className={`toggle ${chime ? 'on' : ''}`}
          onClick={() => { setSkillTimerChime(!chime); if (!chime) playTimerChime() }}>
          <span />
        </button>
      </div>
      <label className="skill-timer-row">
        <span>{uiText('Время')}</span>
        <span className="skill-timer-seconds">
          <input type="number" inputMode="numeric" min={SKILL_TIMER_MIN} max={SKILL_TIMER_MAX} step={1} value={draft}
            aria-label={uiText('Время, сек')}
            onChange={(event) => setDraft(event.target.value)} onBlur={commit}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} />
          {uiText('сек')}
        </span>
      </label>
    </div>
  )
}
