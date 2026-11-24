import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { displayVersion } from '../app/appVersion'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { dismissIphoneUpdate, iphoneUpdatesShown, startIphoneUpdates, useIphoneUpdate } from './iphoneUpdate'
import '../styles/iphoneUpdate.css'

/**
 * The iPhone app's «Вышла новая версия» (owner, 09.11.2026: «уведомление в верхней части экрана… поверх всех окон. Именно в
 * приложении. И кнопка «Обновить» и крестик»): on top of the screen over every window of the app, «Обновить» to the App
 * Store or the site (iphoneUpdate.ts), the cross hides it until a newer version. «Обновление» keeps its line meanwhile.
 */
export function IphoneUpdateBanner() {
  const { available, dismissed } = useIphoneUpdate()
  const { pathname } = useLocation()
  useEffect(() => { startIphoneUpdates() }, [])
  if (!iphoneUpdatesShown() || !available || available === dismissed || pathname.startsWith('/live')) return null
  return createPortal(
    <div className="iphone-update" role="status" aria-live="polite">
      <span className="iphone-update-icon" aria-hidden="true"><RefreshCw size={17} /></span>
      <strong className="iphone-update-text">{`${uiText('Вышла новая версия')} ${displayVersion(available)}`}</strong>
      <IphoneUpdateLink className="button small primary iphone-update-go" />
      <button type="button" className="icon-button iphone-update-close" aria-label={uiText('Закрыть')} title={uiText('Закрыть')} onClick={dismissIphoneUpdate}><X size={15} /></button>
    </div>,
    document.body,
  )
}

/** «Обновить»: the App Store page or the site's download page, as the server's switch says. */
export function IphoneUpdateLink({ className }: { className: string }) {
  const { url } = useIphoneUpdate()
  // Not the shared «Обновить» (it means «Refresh» in English elsewhere).
  const { locale } = useLocale()
  return <a className={className} href={url} target="_blank" rel="noopener noreferrer"><RefreshCw size={14} />{locale === 'en' ? 'Update' : 'Обновить'}</a>
}
