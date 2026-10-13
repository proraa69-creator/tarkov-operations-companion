import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, LoaderCircle, RotateCcw } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { useScreenReading } from '../account/logNickname'
import { modeTitle } from '../account/nicknameBinding'
import './firstRunGuide.css'

/** Shown once on this computer: «Понятно» puts it away for good. */
export const GAME_RESTART_NOTICE_KEY = 'raidos.first-launch.game-restart.v1'
/** Let the start-up windows (sign-in, update, subscription) come first. */
const START_DELAY_MS = 1500

const seen = () => {
  try { return localStorage.getItem(GAME_RESTART_NOTICE_KEY) === '1' } catch { return false }
}

/**
 * The first launch of the desktop app (owner, 13.10.2026: «при старте не нужно вводить ник, должно появится всплывающее
 * окно, что для первого запуска приложения нужно выключить тарков если он включен и запустить заново, это делается только
 * при первом запуске»). The game shows «Выбор профиля и режима» when it starts; the app reads the nickname and every mode's
 * level from it (account/logNickname.ts). What it has read shows here as soon as it is read.
 */
export function GameRestartNotice() {
  const [open, setOpen] = useState(() => Boolean(window.tarkovDesktop) && !seen())
  const [ready, setReady] = useState(false)
  const reading = useScreenReading()
  const button = useRef<HTMLButtonElement>(null)

  // After the start-up windows: not over the sign-in, the update or another notice.
  useEffect(() => {
    if (!open) return
    const started = Date.now()
    const check = () => Date.now() - started >= START_DELAY_MS && !document.querySelector('[aria-modal="true"]')
    const timer = window.setInterval(() => { if (check()) { window.clearInterval(timer); setReady(true) } }, 300)
    return () => window.clearInterval(timer)
  }, [open])
  useEffect(() => { if (ready) button.current?.focus({ preventScroll: true }) }, [ready])

  if (!open || !ready) return null
  const close = () => {
    try { localStorage.setItem(GAME_RESTART_NOTICE_KEY, '1') } catch { /* storage unavailable: shown again next time */ }
    setOpen(false)
  }
  return createPortal(
    <div className="frg-layer" onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
      <div className="frg-dim" />
      <div className="frg-card is-placed is-center" role="dialog" aria-modal="true" aria-labelledby="grn-title" aria-describedby="grn-text">
        <div className="frg-eyebrow"><RotateCcw size={13} aria-hidden="true" /> {uiLabel('Первый запуск')}</div>
        <h2 id="grn-title">{uiLabel('Перезапустите Escape from Tarkov')}</h2>
        <p id="grn-text">{uiLabel('Если игра запущена — закройте её и запустите снова. При входе игра покажет «Выбор профиля и режима»: Raid OS прочитает с этого экрана ваш ник и уровень в PvP, PvE и Сезоне. Вводить ник не нужно.')}</p>
        <div className={`grn-status${reading ? ' is-done' : ''}`} role="status">
          {reading
            ? <><CheckCircle2 size={15} aria-hidden="true" /><span>{reading.nickname ? `${reading.nickname} · ` : ''}{reading.cards.map((card) => `${uiLabel(modeTitle(card.mode))} ${card.level}`).join(' · ')}</span></>
            : <><LoaderCircle size={15} className="spin" aria-hidden="true" /><span>{uiLabel('Ждём экран выбора режима…')}</span></>}
        </div>
        <p className="grn-note">{uiLabel('Это нужно только при первом запуске. Экран читается на этом компьютере, картинки никуда не отправляются.')}</p>
        <button ref={button} type="button" className="button primary frg-accept" onClick={close}>{uiLabel('Понятно')}</button>
      </div>
    </div>,
    document.body,
  )
}
