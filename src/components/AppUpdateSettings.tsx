import { useEffect, useState } from 'react'
import { Download, LoaderCircle, RotateCcw } from 'lucide-react'
import { useAppVersion } from '../app/appVersion'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import type { UpdateCheckResult, UpdateSettings, UpdateStatus } from '../electron'
import '../styles/appUpdateSettings.css'

const OUTCOME_TEXT: Record<UpdateCheckResult['outcome'], string> = {
  available: 'Найдена новая версия',
  latest: 'Установлена последняя версия',
  offline: 'Сервер обновлений недоступен, попробуйте позже',
  unsigned: 'Версия на сервере без действительной подписи, обновление не предлагается',
  'no-server': 'Не задан сервер обновлений (адрес сервера другого компьютера)',
  'not-portable': 'Обновление работает только в собранной portable-версии',
  disabled: 'В этой сборке обновление выключено',
  busy: 'Обновление уже загружается',
}

/**
 * Settings → Данные: «Проверить обновление приложения» (electron/appUpdate.ts through update:check), «Обновить» when a
 * newer build is found, and the «Автообновление» / «Автоустановка» switches kept by the main process.
 */
export function AppUpdateSettings() {
  const api = window.tarkovDesktop?.update
  const { locale } = useLocale()
  const version = useAppVersion()
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [settings, setSettings] = useState<UpdateSettings | null>(null)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UpdateCheckResult | null>(null)

  useEffect(() => {
    if (!api) return
    void api.status().then(setStatus).catch(() => {})
    void api.settings?.().then(setSettings).catch(() => {})
    return api.onStatus(setStatus)
  }, [api])

  const check = async () => {
    if (!api?.check || checking) return
    setChecking(true)
    try {
      const next = await api.check()
      setResult(next)
      setStatus(next.status)
    } catch {
      setResult({ outcome: 'offline', status, current: version, checkedAt: new Date().toISOString() })
    } finally {
      setChecking(false)
    }
  }
  const change = (patch: Partial<UpdateSettings>) => {
    if (!api?.setSettings || !settings) return
    setSettings({ ...settings, ...patch })
    void api.setSettings(patch).then(setSettings).catch(() => {})
  }

  const busy = status.state === 'downloading' || status.state === 'installing'
  const found = status.state === 'available' || status.state === 'error' || busy
  const time = result ? new Date(result.checkedAt).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''
  let line = `${uiText('Версия')} ${version}`
  if (status.state === 'downloading') line += ` · ${uiText('Загрузка обновления')} ${status.progress ?? 0}%`
  else if (status.state === 'installing') line += ` · ${uiText('Перезапуск…')}`
  else if (status.state === 'error') line += ` · ${uiText(status.error ?? 'Ошибка обновления')}`
  else if (status.state === 'available') line += ` · ${uiText('Доступна новая версия')}${status.version ? ` ${status.version}` : ''}${status.ready ? ` · ${uiText('уже загружена')}` : ''}`
  else if (result) line += ` · ${uiText(OUTCOME_TEXT[result.outcome])} (${time})`
  const autoCheck = settings?.autoCheck ?? true
  const autoInstall = settings?.autoInstall ?? false
  const noSwitches = !api?.setSettings || !settings

  return (
    <>
      <div className="setting-row app-update-row">
        <span>
          <strong>{uiText('Обновление приложения')}</strong>
          <small>{api ? line : `${uiText('Версия')} ${version} · ${uiText('Обновления приложения приходят в версии для Windows')}`}</small>
        </span>
        <span className="app-update-actions">
          {found && api && (
            <button type="button" className={`button small${status.state === 'error' ? '' : ' primary'}`} disabled={busy} onClick={() => void api.install().then(setStatus)}>
              {busy ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />}
              {status.state === 'error' ? uiText(' Повторить') : locale === 'en' ? ' Update' : ' Обновить'}
            </button>
          )}
          <button type="button" className="button small" disabled={!api?.check || checking || busy} onClick={() => void check()}>
            <RotateCcw size={13} className={checking ? 'spin' : ''} />{uiText(' Проверить обновление приложения')}
          </button>
        </span>
      </div>
      <div className="setting-row">
        <span>
          <strong>{uiText('Автообновление')}</strong>
          <small>{uiText('Проверять новую версию при запуске и каждые 6 часов')}</small>
        </span>
        <button type="button" role="switch" aria-checked={autoCheck} aria-label={uiText('Автообновление')} className={`toggle ${autoCheck ? 'on' : ''}`} disabled={noSwitches} onClick={() => change({ autoCheck: !autoCheck })}>
          <span />
        </button>
      </div>
      <div className="setting-row">
        <span>
          <strong>{uiText('Автоустановка')}</strong>
          <small>{uiText('Ставить найденную версию самому: сразу после запуска (не во время рейда) или при закрытии приложения')}</small>
        </span>
        <button type="button" role="switch" aria-checked={autoInstall} aria-label={uiText('Автоустановка')} className={`toggle ${autoInstall ? 'on' : ''}`} disabled={noSwitches || !autoCheck} onClick={() => change({ autoInstall: !autoInstall })}>
          <span />
        </button>
      </div>
    </>
  )
}
