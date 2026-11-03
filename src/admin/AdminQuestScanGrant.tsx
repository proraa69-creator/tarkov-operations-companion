import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { LoaderCircle, ScanSearch } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import type { AdminRequest } from './ownerAccess'

export const TRIAL_FEATURES_PATH = '/v1/accounts/me/admin/trial-features'
/** «На сутки». */
const DAY_HOURS = 24

interface Grant { email: string; until: string; grantedBy: string }

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')

function grantsOf(answer: unknown): Grant[] {
  const list = (answer as { grants?: unknown } | null)?.grants
  return Array.isArray(list) ? list.filter((entry): entry is Grant => Boolean(entry) && typeof entry.email === 'string' && typeof entry.until === 'string') : []
}

/**
 * «Поиск квестов по экрану» for one player (owner, 01.11.2026: «ввожу его почту и нажимаю включить поиск по экрану на
 * сутки»): the game's «Задания» table is read from the screen even when the player's logs look complete
 * (src/components/StoryScreenScanner.tsx). The player's app hears it within seconds (server/src/routes/trialFeatures.ts)
 * and it ends by itself.
 */
export function AdminQuestScanGrant({ request }: { request: AdminRequest }) {
  const [email, setEmail] = useState('')
  const [grants, setGrants] = useState<Grant[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const load = useCallback(() => request('GET', TRIAL_FEATURES_PATH).then((answer) => setGrants(grantsOf(answer))), [request])
  useEffect(() => { void load().catch((reason: unknown) => setError(errorText(reason))) }, [load])

  const change = async (address: string, hours: number) => {
    setBusy(`${address}:${hours}`)
    setError('')
    setDone('')
    try {
      const answer = await request('PUT', TRIAL_FEATURES_PATH, { email: address, feature: 'questTableScan', hours }) as { grant?: Grant } | null
      if (!answer?.grant) throw new Error('Сервер недоступен')
      setDone(hours ? `${uiLabel('Включено для')} ${answer.grant.email} ${uiLabel('до')} ${new Date(answer.grant.until).toLocaleString()}` : `${uiLabel('Выключено для')} ${answer.grant.email}`)
      if (hours) setEmail('')
      await load()
    } catch (reason) {
      setError(errorText(reason) || 'Не удалось изменить. Попробуйте ещё раз.')
    } finally {
      setBusy('')
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (email.trim()) void change(email.trim(), DAY_HOURS)
  }

  return (
    <div className="admin-feature admin-trial-feature">
      <ScanSearch size={18} aria-hidden="true" />
      <div className="admin-feature-body">
        <strong>{uiLabel('Поиск квестов по экрану для игрока')}</strong>
        <p>{uiLabel('Приложение игрока читает таблицу «Задания» с экрана игры, даже если логи выглядят полными. Включается сразу, на сутки, и выключается само.')}</p>
        <form className="admin-trial-form" onSubmit={submit}>
          <input type="email" className="input" placeholder={uiLabel('E-mail игрока')} aria-label={uiLabel('E-mail игрока')} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
          <button type="submit" className="button small primary" disabled={Boolean(busy) || !email.trim()}>
            {busy === `${email.trim()}:${DAY_HOURS}` && <LoaderCircle size={13} className="spin" aria-hidden="true" />}{uiLabel('Включить на сутки')}
          </button>
        </form>
        {grants.length > 0 && (
          <ul className="admin-trial-list">
            {grants.map((grant) => (
              <li key={grant.email}>
                <span>{grant.email}</span>
                <small className="dim">{uiLabel('до')} {new Date(grant.until).toLocaleString()}</small>
                <button type="button" className="button small ghost" disabled={Boolean(busy)} onClick={() => void change(grant.email, 0)}>
                  {busy === `${grant.email}:0` && <LoaderCircle size={13} className="spin" aria-hidden="true" />}{uiLabel('Выключить')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {done && <small className="admin-feature-state is-on" role="status">{done}</small>}
        {error && <p className="owner-notices-error" role="alert">{uiLabel(error)}</p>}
      </div>
    </div>
  )
}
