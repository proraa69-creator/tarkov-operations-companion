import { useEffect, useState } from 'react'
import { LoaderCircle, MapPinned, Power } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { parseFeatures, setRemoteFeatures, useRemoteFeatures, type RemoteFeatures } from '../announcement/features'
import type { AdminRequest } from './ownerAccess'

export const FEATURES_PATH = '/v1/accounts/me/admin/features'

/**
 * The switches for every player's app (server/src/routes/announcement.ts `features`). One row per switch, so a new one
 * is one more entry here and on the server.
 */
const SWITCHES: ReadonlyArray<{ key: 'minimap'; title: string; hint: string; icon: typeof Power }> = [
  {
    key: 'minimap',
    title: 'Местоположение на карте',
    hint: 'Позиция игрока по скриншотам игры на «Картах» и в телефоне. Выключено — ни у кого нет позиции, приложение не следит за папкой скриншотов.',
    icon: MapPinned,
  },
]

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')

/** «Функции»: each switch on or off for everybody at once (the apps get it with the notice, within a few minutes). */
export function AdminFeaturesSection({ request }: { request: AdminRequest }) {
  const features = useRemoteFeatures()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [changedAt, setChangedAt] = useState('')

  useEffect(() => {
    let alive = true
    void request('GET', FEATURES_PATH).then((answer) => {
      const value = parseFeatures(answer)
      if (!alive || !value) return
      setRemoteFeatures(value)
      const at = (answer as { features?: { updatedAt?: unknown } } | null)?.features?.updatedAt
      if (typeof at === 'string') setChangedAt(at)
    }).catch((reason: unknown) => { if (alive) setError(errorText(reason)) })
    return () => { alive = false }
  }, [request])

  const toggle = async (key: keyof Pick<RemoteFeatures, 'minimap'>, enabled: boolean) => {
    setBusy(key)
    setError('')
    try {
      const answer = await request('PUT', FEATURES_PATH, { [key]: enabled })
      const saved = parseFeatures(answer)
      if (!saved) throw new Error('Сервер недоступен')
      setRemoteFeatures(saved)
      const at = (answer as { features?: { updatedAt?: unknown } } | null)?.features?.updatedAt
      if (typeof at === 'string') setChangedAt(at)
    } catch (reason) {
      setError(errorText(reason) || 'Не удалось переключить. Проверьте вход в аккаунт владельца и попробуйте ещё раз.')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="panel admin-section" aria-labelledby="admin-features-title">
      <div className="panel-header">
        <div><div className="eyebrow">{uiLabel('Для всех игроков сразу')}</div><div className="panel-title" id="admin-features-title">{uiLabel('Функции')}</div></div>
        <Power size={18} className="brass" aria-hidden="true" />
      </div>
      <div className="panel-body admin-features">
        {SWITCHES.map(({ key, title, hint, icon: Icon }) => {
          const on = features[key]
          return (
            <div key={key} className={`admin-feature${on ? ' is-on' : ''}`}>
              <Icon size={18} aria-hidden="true" />
              <div className="admin-feature-body">
                <strong>{uiLabel(title)}</strong>
                <p>{uiLabel(hint)}</p>
                <small className={`admin-feature-state${on ? ' is-on' : ''}`}>{uiLabel(!features.known ? 'Загрузка с сервера…' : on ? 'Включено у всех' : 'Выключено у всех')}</small>
              </div>
              <button type="button" className={`button small ${on ? 'ghost' : 'primary'}`} disabled={Boolean(busy) || !features.known} onClick={() => void toggle(key, !on)}>
                {busy === key && <LoaderCircle size={13} className="spin" aria-hidden="true" />}{uiLabel(on ? 'Выключить для всех' : 'Включить для всех')}
              </button>
            </div>
          )
        })}
        {changedAt && <small className="dim">{uiLabel('Последнее изменение')}: {new Date(changedAt).toLocaleString()}</small>}
        <small className="dim">{uiLabel('Приложения игроков узнают о переключении в течение нескольких минут или сразу, когда окно снова в фокусе.')}</small>
        {error && <p className="owner-notices-error" role="alert">{uiLabel(error)}</p>}
      </div>
    </section>
  )
}
