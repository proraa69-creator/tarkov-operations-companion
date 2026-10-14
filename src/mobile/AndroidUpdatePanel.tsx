import { useEffect } from 'react'
import { Download, LoaderCircle, RotateCcw, Settings, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAppVersion } from '../app/appVersion'
import { uiText } from '../i18n/renderText'
import { androidUpdateErrorText, androidUpdater, useAndroidUpdate, type AndroidUpdateState } from './androidUpdate'
import '../styles/androidUpdate.css'

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} ${uiText('МБ')}`

/** What the player can do now: download, install, allow installs or try again. */
function action(state: AndroidUpdateState): { label: string; run: () => void; icon: typeof Download } | null {
  const updater = androidUpdater()
  if (state.phase === 'available') return { label: 'Скачать', run: () => void updater.download(), icon: Download }
  if (state.phase === 'ready') return { label: 'Установить', run: () => void updater.install(), icon: Download }
  if (state.phase === 'permission') return { label: 'Открыть настройки', run: () => void updater.openSettings(), icon: Settings }
  if (state.phase === 'error' && state.release && state.failed === 'download') return { label: 'Повторить', run: () => void updater.download(), icon: RotateCcw }
  if (state.phase === 'error' && state.release && state.failed === 'install') return { label: 'Повторить', run: () => void updater.install(), icon: RotateCcw }
  return null
}

/**
 * The Android app's update card above the tab bar: a newer build on mobile data («Скачать»), the download, «Установить»,
 * Android's permission to install from Raid OS, a failed download. Not on «Мини Карта» (the map in a raid stays clear).
 * Starts the check once per app start (src/mobile/androidUpdate.ts).
 */
export function AndroidUpdateBanner() {
  const state = useAndroidUpdate()
  const { pathname } = useLocation()
  useEffect(() => { androidUpdater().start() }, [])

  const release = state.release
  if (state.phase === 'off' || !release || pathname.startsWith('/live')) return null
  if (state.dismissed === release.versionCode && state.phase !== 'permission') return null
  let title: string
  let detail: string
  if (state.phase === 'available') {
    title = `${uiText('Доступна новая версия')} ${release.versionName}`
    detail = `${megabytes(release.size)}${state.metered ? ` · ${uiText('скачается по нажатию: сейчас мобильный интернет')}` : ''}`
  } else if (state.phase === 'downloading') {
    title = `${uiText('Загружаем обновление')} ${release.versionName}`
    detail = `${state.progress ?? 0}% · ${megabytes(release.size)}`
  } else if (state.phase === 'ready') {
    title = uiText('Обновление готово к установке')
    detail = `${uiText('Версия')} ${release.versionName} · ${uiText('Android попросит подтвердить установку')}`
  } else if (state.phase === 'permission') {
    title = uiText('Разрешите установку обновления')
    detail = uiText('В настройках включите «Разрешить из этого источника» для Raid OS и вернитесь в приложение')
  } else if (state.phase === 'error' && state.failed !== 'check') {
    title = uiText('Обновление не установлено')
    detail = uiText(androidUpdateErrorText(state.error))
  } else {
    return null
  }
  const next = action(state)
  const Icon = next?.icon
  return (
    <div className={`panel android-update is-${state.phase}`} role="status" aria-live="polite">
      <span className="android-update-icon" aria-hidden="true">
        {state.phase === 'downloading' ? <LoaderCircle size={18} className="spin" /> : <Download size={18} />}
      </span>
      <span className="android-update-text">
        <strong>{title}</strong>
        <small>{detail}</small>
        {state.phase === 'downloading' && (
          <span className="android-update-bar" aria-hidden="true"><span style={{ transform: `scaleX(${(state.progress ?? 0) / 100})` }} /></span>
        )}
      </span>
      {state.phase !== 'downloading' && (
        <button type="button" className="icon-button android-update-close" aria-label={uiText('Позже')} title={uiText('Позже')} onClick={() => androidUpdater().dismiss()}><X size={15} /></button>
      )}
      {next && Icon && (
        <span className="android-update-actions">
          <button type="button" className="button small primary" onClick={next.run}><Icon size={14} />{uiText(next.label)}</button>
        </span>
      )}
    </div>
  )
}

/** Settings → «Обновление приложения» in the Android app (instead of the Windows app's row). */
export function AndroidUpdateSettings() {
  const state = useAndroidUpdate()
  const version = useAppVersion()
  const updater = androidUpdater()
  const release = state.release
  let line = `${uiText('Версия')} ${version}`
  if (state.phase === 'idle' || state.phase === 'checking') line += ` · ${uiText('Проверяем обновления…')}`
  else if (state.phase === 'latest') line += ` · ${uiText('Установлена последняя версия')}`
  else if (state.phase === 'none') line += ` · ${uiText('Обновлений на сайте пока нет')}`
  else if (state.phase === 'available' && release) line += ` · ${uiText('Доступна новая версия')} ${release.versionName} (${megabytes(release.size)})`
  else if (state.phase === 'downloading') line += ` · ${uiText('Загрузка обновления')} ${state.progress ?? 0}%`
  else if (state.phase === 'ready' && release) line += ` · ${uiText('Новая версия загружена')} ${release.versionName}`
  else if (state.phase === 'installing') line += ` · ${uiText('Открыта установка…')}`
  else if (state.phase === 'permission') line += ` · ${uiText('Разрешите установку обновления')}`
  else if (state.phase === 'error') line += ` · ${uiText(androidUpdateErrorText(state.error))}`
  const next = action(state)
  const Icon = next?.icon
  const busy = state.phase === 'checking' || state.phase === 'downloading'
  return (
    <>
      <div className="setting-row app-update-row">
        <span>
          <strong>{uiText('Обновление приложения')}</strong>
          <small>{line}</small>
        </span>
        <span className="app-update-actions">
          {next && Icon && (
            <button type="button" className="button small primary" onClick={next.run}><Icon size={13} />{uiText(next.label)}</button>
          )}
          <button type="button" className="button small" disabled={busy || state.phase === 'off'} onClick={() => void updater.check()}>
            <RotateCcw size={13} className={state.phase === 'checking' ? 'spin' : ''} />{uiText('Проверить обновления')}
          </button>
        </span>
      </div>
      <div className="setting-row">
        <span>
          <strong>{uiText('Скачивать обновления автоматически')}</strong>
          <small>{uiText('Только по Wi-Fi. Установка — после нажатия «Установить».')}</small>
        </span>
        <button type="button" role="switch" aria-checked={state.autoDownload} aria-label={uiText('Скачивать обновления автоматически')} className={`toggle ${state.autoDownload ? 'on' : ''}`} onClick={() => updater.setAutoDownload(!state.autoDownload)}>
          <span />
        </button>
      </div>
    </>
  )
}
