import { useEffect } from 'react'
import { Download, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { displayVersion } from '../app/appVersion'
import { uiText } from '../i18n/renderText'
import { dismissIphoneUpdate, IPHONE_DOWNLOAD_PAGE, iphoneUpdatesShown, startIphoneUpdates, useIphoneUpdate } from './iphoneUpdate'
import '../styles/androidUpdate.css'

/**
 * The iPhone app's «Вышла новая версия» card above the tab bar, styled like the Android one (AndroidUpdatePanel.tsx):
 * the new version and a link to the site's download page. «Позже» hides it until a newer version.
 */
export function IphoneUpdateBanner() {
  const { available, dismissed } = useIphoneUpdate()
  const { pathname } = useLocation()
  useEffect(() => { startIphoneUpdates() }, [])
  if (!iphoneUpdatesShown() || !available || available === dismissed || pathname.startsWith('/live')) return null
  return (
    <div className="panel android-update is-available" role="status" aria-live="polite">
      <span className="android-update-icon" aria-hidden="true"><Download size={18} /></span>
      <span className="android-update-text">
        <strong>{`${uiText('Вышла новая версия')} ${displayVersion(available)}`}</strong>
        <small>{uiText('Скачайте её на сайте raidos.app и установите поверх этой.')}</small>
      </span>
      <button type="button" className="icon-button android-update-close" aria-label={uiText('Позже')} title={uiText('Позже')} onClick={dismissIphoneUpdate}><X size={15} /></button>
      <span className="android-update-actions">
        <a className="button small primary" href={IPHONE_DOWNLOAD_PAGE} target="_blank" rel="noopener noreferrer"><Download size={14} />{uiText('Скачать на сайте')}</a>
      </span>
    </div>
  )
}
