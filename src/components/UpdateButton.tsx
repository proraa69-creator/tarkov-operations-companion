import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, Download, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react'
import { displayVersion, useAppVersion } from '../app/appVersion'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import type { UpdateStatus } from '../electron'
import '../styles/updateOverlay.css'

type Step = 'download' | 'verify' | 'install'
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'download', label: 'Скачивание' },
  { id: 'verify', label: 'Проверка' },
  { id: 'install', label: 'Установка и перезапуск' },
]

/**
 * The owner's copy, a release with another Electron or other files outside the archive, and only while the server has
 * no signed manifest of the owner exe (electron/appUpdate.ts ownerExe, the fallback). With one, the owner's copy
 * downloads and installs that exe here like any update, and this text is not shown.
 */
const OWNER_EXE_TEXT = 'Частями её не поставить, а подписанной серверной версии на сервере пока нет: скачайте «Raid OS Server.exe» в админ-панели (раздел «Серверная версия») и замените им этот exe.'

/** Downloaded in the background, starts with the next launch (electron/appUpdate.ts nextStart). */
const NEXT_START_TEXT = 'Обновление скачано — применится при следующем запуске'
/** The live update of the interface is announced once per version, also after the page reloads. */
const LIVE_SHOWN_KEY = 'raidos.liveUpdateShown'
const LIVE_TOAST_MS = 9_000

function stepOf(status: UpdateStatus): Step {
  if (status.state === 'installing') return 'install'
  if (status.state === 'downloading' && status.phase === 'verifying') return 'verify'
  return 'download'
}

/**
 * Top bar: «Обновить» when the server laptop hands out a newer build (electron/appUpdate.ts). The button keeps one
 * size in every state (no progress text in the bar, so nothing next to it moves); a click opens the full-screen
 * «Обновление до актуальной версии» window with the version, a progress bar and the steps скачивание → проверка →
 * установка/перезапуск. Errors show there with «Повторить» / «Закрыть». A download «Автообновление» starts by itself in
 * the background stays in the bar (spinner) until the player opens the window; a release it downloaded for the next start
 * says so in the button (a click restarts now). After the window was switched to a new version without a restart, a short
 * notice «Приложение обновлено до версии X».
 */
export function UpdateButton() {
  const api = window.tarkovDesktop?.update
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!api) return
    void api.status().then((next) => {
      setStatus(next)
      if ((next.state === 'downloading' || next.state === 'installing') && !next.background) setOpen(true)
    }).catch(() => {})
    return api.onStatus((next) => {
      setStatus(next)
      // a download / restart the player did not start in the background (start-up auto-install) shows itself
      if ((next.state === 'downloading' || next.state === 'installing') && !next.background) setOpen(true)
    })
  }, [api])
  const toast = <LiveUpdateToast version={status.liveVersion} />
  if (!api || status.state === 'idle') return toast
  const busy = status.state === 'downloading' || status.state === 'installing'
  // Notifications off: nothing in the bar unless the player started something (a background download stays quiet).
  if (!open && status.notify === false && (!busy || status.background)) return toast
  const start = () => {
    // The fallback (no signed owner exe on the server): the click checks once more, then opens the admin panel — or, if
    // a signed owner exe appeared meanwhile, starts the update here, which then opens the window by its status.
    if (status.ownerExe) { void api.install().then(setStatus).catch(() => {}); return }
    setOpen(true)
    if (!busy) void api.install().then(setStatus).catch(() => {})
  }
  const nextStart = status.state === 'available' && status.nextStart === true
  const label = status.state === 'error' ? 'Повторить обновление' : busy ? 'Обновление…' : status.ownerExe ? 'Скачать новую версию' : nextStart ? NEXT_START_TEXT : 'Обновить приложение'
  const newVersion = `${uiText('Доступна новая версия')}${status.version ? ` ${displayVersion(status.version)}` : ''}.`
  const title = status.state === 'error' ? uiText(status.error ?? 'Ошибка обновления')
    : status.ownerExe ? `${newVersion} ${uiText(OWNER_EXE_TEXT)}`
    : nextStart ? `${uiText(NEXT_START_TEXT)}. ${uiText('Нажмите, чтобы перезапустить сейчас: настройки и прогресс сохранятся.')}`
    : `${newVersion} ${uiText('Приложение перезапустится, настройки и прогресс сохранятся.')}`
  return (
    <>
      <button type="button" className={`button small update-button${status.state === 'error' ? ' is-error' : ' primary'}${busy ? ' is-busy' : ''}${nextStart ? ' is-next-start' : ''}`} title={title} aria-haspopup="dialog" onClick={start}>
        {busy ? <LoaderCircle size={14} className="spin" /> : status.state === 'error' ? <AlertTriangle size={14} /> : nextStart ? <Check size={14} /> : <Download size={14} />}
        <span className="update-button-label">{uiText(label)}</span>
      </button>
      {open && createPortal(<UpdateOverlay status={status} onRetry={() => void api.install().then(setStatus).catch(() => {})} onClose={() => setOpen(false)} />, document.body)}
      {toast}
    </>
  )
}

function liveShown() {
  try { return localStorage.getItem(LIVE_SHOWN_KEY) } catch { return null }
}

/**
 * «Приложение обновлено до версии X»: the window now shows a version the live update put in without a restart
 * (electron/appUpdate.ts liveVersion). Once per version (remembered in localStorage), closes by itself, never blocks.
 */
export function LiveUpdateToast({ version }: { version?: string }) {
  // Announced before this page mounted (the same version after a reload or a remount is not announced again).
  const [seen] = useState(liveShown)
  const [closed, setClosed] = useState<string | null>(null)
  const shown = version && version !== seen && version !== closed ? version : null
  useEffect(() => {
    if (!shown) return
    try { localStorage.setItem(LIVE_SHOWN_KEY, shown) } catch { /* shown again next time */ }
    const timer = window.setTimeout(() => setClosed(shown), LIVE_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [shown])
  if (!shown) return null
  return createPortal(<div className="update-live-toast panel" role="status" aria-live="polite">
    <Sparkles size={16} aria-hidden="true" />
    <span>{uiText('Приложение обновлено до версии')} {displayVersion(shown)}</span>
    <button type="button" className="icon-button" aria-label={uiText('Закрыть')} title={uiText('Закрыть')} onClick={() => setClosed(shown)}><X size={14} /></button>
  </div>, document.body)
}

/** The full-screen «Обновление до актуальной версии» window. Closable only when nothing is running (available / error). */
export function UpdateOverlay({ status, onRetry, onClose }: { status: UpdateStatus; onRetry: () => void; onClose: () => void }) {
  const current = useAppVersion()
  const { locale } = useLocale()
  const busy = status.state === 'downloading' || status.state === 'installing'
  const failed = status.state === 'error'
  const step = stepOf(status)
  const stepIndex = STEPS.findIndex((entry) => entry.id === step)
  const progress = Math.max(0, Math.min(100, status.state === 'installing' ? 100 : status.progress ?? 0))
  const closeRef = useRef<HTMLButtonElement>(null)
  const [raidNoteHidden, setRaidNoteHidden] = useState(false)
  useEffect(() => { if (failed) closeRef.current?.focus() }, [failed])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  const stateText = failed ? 'Ошибка обновления'
    : status.state === 'installing' ? 'Установка: приложение закроется и запустится на новой версии'
    : step === 'verify' ? 'Проверка файла (размер и подпись SHA-256)'
    : status.state === 'downloading' ? 'Скачивание новой версии'
    : 'Готово к обновлению'

  return (
    <div className="update-overlay" role="dialog" aria-modal="true" aria-labelledby="update-overlay-title">
      <div className={`update-overlay-card${failed ? ' is-error' : ''}`}>
        {!busy && <button type="button" className="icon-button update-overlay-x" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={16} /></button>}
        <div className="update-overlay-eyebrow">Raid OS</div>
        <h2 id="update-overlay-title" className="update-overlay-title">{uiText('Обновление до актуальной версии')}</h2>
        <div className="update-overlay-versions">
          <span>{uiText('Сейчас')} <b>{current}</b></span>
          <span aria-hidden="true">→</span>
          <span>{uiText('Новая')} <b>{status.version ? displayVersion(status.version) : '—'}</b></span>
        </div>

        <div className="update-overlay-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={uiText(stateText)}>
          <i style={{ width: `${progress}%` }} className={busy ? 'is-running' : ''} />
        </div>
        <div className="update-overlay-status">
          <span>{busy ? <LoaderCircle size={14} className="spin" /> : failed ? <AlertTriangle size={14} /> : null}{uiText(stateText)}</span>
          {!failed && <b>{progress}%</b>}
        </div>

        <ol className="update-overlay-steps">
          {STEPS.map((entry, index) => {
            const done = !failed && index < stepIndex
            const active = !failed && busy && index === stepIndex
            return <li key={entry.id} className={`${done ? 'is-done' : ''}${active ? ' is-active' : ''}`}>
              <span className="update-overlay-step-mark">{done ? <Check size={12} /> : index + 1}</span>{uiText(entry.label)}
            </li>
          })}
        </ol>

        {failed && <p className="update-overlay-error">{uiText(status.error ?? 'Ошибка обновления')}</p>}
        {status.blockedByRaid && !raidNoteHidden && <p className="update-overlay-error update-overlay-note-closable">
          <span>{uiText('Автоматически обновление не ставится во время рейда. Нажмите «Обновить», чтобы установить сейчас.')}</span>
          <button type="button" className="update-overlay-note-close" aria-label={uiText('Скрыть')} onClick={() => setRaidNoteHidden(true)}><X size={14} /></button>
        </p>}
        {!busy && <div className="update-overlay-actions">
          {failed
            ? <button type="button" className="button primary" onClick={onRetry}><RotateCcw size={15} />{uiText(' Повторить')}</button>
            : <button type="button" className="button primary" onClick={onRetry}><Download size={15} />{locale === 'en' ? ' Update' : ' Обновить'}</button>}
          <button type="button" className="button" ref={closeRef} onClick={onClose}>{uiText('Закрыть')}</button>
        </div>}
        <p className="update-overlay-note">{uiText('Приложение перезапустится, настройки и прогресс сохранятся.')}</p>
      </div>
    </div>
  )
}
