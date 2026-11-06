import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, LoaderCircle, RotateCcw } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { useScreenReading } from '../account/logNickname'
import { modeTitle } from '../account/nicknameBinding'
import { useWindowTurn } from '../app/windowTurn'
import { gameRestartNoticeDue, noteGameRestartNoticeShown } from './gameStarts'
import './firstRunGuide.css'

/** Let the start-up windows (sign-in, update, subscription) come first. */
const START_DELAY_MS = 1500

/**
 * The first launch of the desktop app (owner, 13.10.2026: «при старте не нужно вводить ник, должно появится всплывающее
 * окно, что для первого запуска приложения нужно выключить тарков если он включен и запустить заново, это делается только
 * при первом запуске»). The game shows «Выбор профиля и режима» when it starts; the app reads the nickname and every mode's
 * level from it (account/logNickname.ts). What it has read shows here as soon as it is read. Also what the logs cannot do
 * (owner, 03.11.2026: «укажи что из за того что логи удаляются, их может не быть на момент входа в приложение, поэтому
 * квесты частично будут отсутствовать… нужно при первом входе один раз просканировать все квесты либо отметить в ручную,
 * после этого будет работать автосинхронизация»; «более короче и понятнее»).
 *
 * Shown once per computer (owner, 16.10.2026), and only while that screen has not been read here yet
 * (src/onboarding/gameStarts.ts).
 */
export function GameRestartNotice() {
  const [open, setOpen] = useState(() => Boolean(window.tarkovDesktop) && gameRestartNoticeDue())
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
  // The owner's words of 07.11.2026: close the game, start the app, then the game; the app finds the login and level; nothing to worry about.
  // One window at a time (app/windowTurn.ts): in line once the start-up windows are gone, the turn kept while it is open.
  const turn = useWindowTurn('game-restart', open && ready)
  const showing = open && ready && turn
  useEffect(() => {
    if (!showing) return
    noteGameRestartNoticeShown()
    button.current?.focus({ preventScroll: true })
  }, [showing])

  if (!showing) return null
  const close = () => setOpen(false)
  return createPortal(
    <div className="frg-layer" onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
      <div className="frg-dim" />
      <div className="frg-card is-placed is-center" role="dialog" aria-modal="true" aria-labelledby="grn-title" aria-describedby="grn-text">
        <div className="frg-eyebrow"><RotateCcw size={13} aria-hidden="true" /> {uiLabel('Первый запуск')}</div>
        <h2 id="grn-title">{uiLabel('Сначала Raid OS, потом игра')}</h2>
        <ol id="grn-text" className="grn-steps">
          <li>{uiLabel('Закройте игру, если она открыта.')}</li>
          <li>{uiLabel('Оставьте Raid OS запущенным и только потом запустите игру.')}</li>
          <li>{uiLabel('Приложение само найдёт на экране ваш логин и уровень.')}</li>
        </ol>
        <div className={`grn-status${reading ? ' is-done' : ''}`} role="status">
          {reading
            ? <><CheckCircle2 size={15} aria-hidden="true" /><span>{[reading.nickname ?? '', ...reading.cards.filter((card) => card.level !== undefined).map((card) => `${uiLabel(modeTitle(card.mode))} ${card.level}`)].filter(Boolean).join(' · ')}</span></>
            : <><LoaderCircle size={15} className="spin" aria-hidden="true" /><span>{uiLabel('Ждём экран выбора режима…')}</span></>}
        </div>
        <p className="grn-quests">{uiLabel('Квесты берутся из логов игры, а игра сама удаляет старые логи, поэтому часть квестов может не найтись — обойти это нельзя. Один раз откройте в игре «Персонаж» → «Задания» и пролистайте весь список, квесты добавятся сами, или добавьте их через «Ручное добавление». Дальше всё обновляется по логам.')}</p>
        <p className="grn-note">{uiLabel('Raid OS не нарушает правила игры: не использует её память и не внедряется в неё. Переживать не о чем.')}</p>
        <button ref={button} type="button" className="button primary frg-accept" onClick={close}>{uiLabel('Понятно')}</button>
      </div>
    </div>,
    document.body,
  )
}
