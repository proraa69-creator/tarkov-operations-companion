import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, LoaderCircle } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { UpdateStatus } from '../electron'
import '../styles/updateOverlay.css'

/** «Позже»: the window comes again at the next start, not while this one runs. */
let laterThisRun = false

/**
 * The portable exe, once the site publishes the signed installer (electron/appUpdate.ts installerOffer; owner,
 * 03.11.2026: «сделай установочный файл, можно выбрать куда установить»): one window at the start with «Установить» and
 * «Позже», without explanations (owner: «это не нужно писать»). «Установить» downloads and checks the installer, opens it
 * (the player picks the folder) and the app closes; the installed copy keeps the settings and progress and removes this
 * exe (electron/appInstall.ts). The installed app, the owner's and the site never show it.
 */
export function InstallerOffer() {
  const api = window.tarkovDesktop?.update
  const [offer, setOffer] = useState<{ version: string; size: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    if (laterThisRun || !api?.installerOffer) return
    let alive = true
    void api.installerOffer().then((next) => { if (alive) setOffer(next) }).catch(() => {})
    return () => { alive = false }
  }, [api])
  useEffect(() => (busy && api ? api.onStatus(setStatus) : undefined), [api, busy])
  if (!offer || !api?.installSetup) return null
  const install = async () => {
    setStatus(null)
    setBusy(true)
    const result = await api.installSetup!().catch((error: unknown) => ({ state: 'error', error: error instanceof Error ? error.message : String(error) }) as UpdateStatus)
    if (result.state === 'error') { setStatus(result); setBusy(false) }
  }
  const later = () => { laterThisRun = true; setOffer(null) }
  const failed = !busy && status?.state === 'error'
  const progress = status?.state === 'installing' ? 100 : status?.state === 'downloading' ? status.progress ?? 0 : 0
  return createPortal(
    <div className="update-overlay" role="dialog" aria-modal="true" aria-labelledby="installer-offer-title">
      <div className={`update-overlay-card${failed ? ' is-error' : ''}`}>
        <div className="update-overlay-eyebrow">Raid OS</div>
        <h2 id="installer-offer-title" className="update-overlay-title">{uiText('Raid OS теперь устанавливается как обычная программа')}</h2>
        {busy && <>
          <div className="update-overlay-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={uiText('Скачиваем установщик')}>
            <i className="is-running" style={{ width: `${Math.max(progress, 4)}%` }} />
          </div>
          <div className="update-overlay-status">
            <span><LoaderCircle size={14} className="spin" />{uiText(status?.state === 'installing' ? 'Открываем установщик…' : 'Скачиваем установщик…')}</span>
            <b>{progress}%</b>
          </div>
        </>}
        {failed && <p className="update-overlay-error">{uiText(status?.error ?? 'Не удалось скачать установщик')}</p>}
        {!busy && <div className="update-overlay-actions">
          <button type="button" className="button primary" onClick={() => void install()}><Download size={15} />{uiText(failed ? 'Повторить' : 'Установить')}</button>
          <button type="button" className="button ghost" onClick={later}>{uiText('Позже')}</button>
        </div>}
      </div>
    </div>,
    document.body,
  )
}
