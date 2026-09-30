import { useEffect, useState } from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { UpdateStatus } from '../electron'

/**
 * Top bar: «Обновить» when the server laptop hands out a newer build (electron/appUpdate.ts). One click downloads
 * it, checks it and restarts the app on the new version; settings and progress stay. Hidden otherwise.
 */
export function UpdateButton() {
  const api = window.tarkovDesktop?.update
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  useEffect(() => {
    if (!api) return
    void api.status().then(setStatus).catch(() => {})
    return api.onStatus(setStatus)
  }, [api])
  if (!api || status.state === 'idle') return null
  const busy = status.state === 'downloading' || status.state === 'installing'
  const label = status.state === 'downloading' ? `${uiText('Загрузка обновления')} ${status.progress ?? 0}%`
    : status.state === 'installing' ? uiText('Перезапуск…')
    : status.state === 'error' ? uiText('Повторить обновление')
    : uiText('Обновить приложение')
  const title = status.state === 'error' ? uiText(status.error ?? 'Ошибка обновления')
    : `${uiText('Доступна новая версия')}${status.version ? ` ${status.version}` : ''}${status.commit ? ` (${status.commit})` : ''}. ${uiText('Приложение перезапустится, настройки и прогресс сохранятся.')}`
  return (
    <button className={`button small update-button${status.state === 'error' ? '' : ' primary'}${status.state === 'error' ? ' is-error' : ''}`} disabled={busy} title={title} onClick={() => void api.install().then(setStatus)}>
      {busy ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
      {label}
    </button>
  )
}
