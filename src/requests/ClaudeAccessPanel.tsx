import { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy, EyeOff, KeyRound, LoaderCircle, ShieldOff } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { isOwnerApp } from '../app/buildEdition'
import { cleanIpcError } from '../sync/serverSync'
import '../styles/requests.css'

/**
 * «Доступ Claude к заявкам» (owner app only; owner, 14.10.2026: «2 вариант да»): the read-only key Claude reads the
 * players' reports with from its cloud sessions (server/src/routes/agentRequests.ts, scripts/read-requests.mjs). The
 * owner creates, replaces or revokes it here. A new key is shown once, in this panel only: it is kept in the panel's
 * state, never in localStorage, a log or a query cache, and is gone when the panel closes. The owner puts it into the
 * cloud environment's secrets as RAIDOS_REQUESTS_KEY. Meant for «Заявки» (src/pages/RequestsPage.tsx); needs no props.
 */
const KEY_PATH = '/v1/accounts/me/admin/requests-key'
const KEY_SHAPE = /^rok_[A-Za-z0-9_-]{43}$/
const REPLACE_CONFIRM = 'Заменить ключ? Старый ключ сразу перестанет работать.'
const SECRET_HINT = 'Добавьте его в настройки облачной среды Claude как RAIDOS_REQUESTS_KEY (меню среды в заголовке сессии → Edit → Network secrets). В чат ключ не вставляйте.'
const UNEXPECTED = 'Сервер вернул неожиданный ответ'

interface KeyState { active: boolean; createdAt?: string; lastUsedAt?: string }
type Request = (method: 'GET' | 'POST' | 'DELETE', path: string) => Promise<unknown>

/** The owner app's gateway (electron/serviceGateway.ts): the session stays in the main process. */
const gateway = (): Request | undefined => (typeof window === 'undefined' ? undefined : window.tarkovDesktop?.serviceRequest)
const isoDate = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined)

/** The server's answer, shape-checked; null when the gateway has no session. */
function keyState(raw: unknown): KeyState | null {
  if (raw === null) return null
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined
  if (typeof value?.active !== 'boolean') throw new Error(UNEXPECTED)
  if (!value.active) return { active: false }
  const createdAt = isoDate(value.createdAt)
  const lastUsedAt = isoDate(value.lastUsedAt)
  return { active: true, ...(createdAt ? { createdAt } : {}), ...(lastUsedAt ? { lastUsedAt } : {}) }
}

const errorText = (reason: unknown) => {
  const message = cleanIpcError(reason)
  return message === 'Не найдено' ? 'Ключом управляет только аккаунт владельца. Войдите в него в профиле.' : message
}

export function ClaudeAccessPanel() {
  const owner = isOwnerApp()
  const { locale } = useLocale()
  const titleId = useId()
  const keyInput = useRef<HTMLInputElement>(null)
  /** undefined: still asking; null: no owner session in the app. */
  const [state, setState] = useState<KeyState | null | undefined>(undefined)
  /** The new key, shown once: only here, only until the panel closes or «Скрыть ключ». */
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const request = owner ? gateway() : undefined
    if (!request) return
    let open = true
    request('GET', KEY_PATH)
      .then((answer) => { if (open) { setState(keyState(answer)); setError('') } })
      .catch((reason: unknown) => { if (open) setError(errorText(reason)) })
    return () => { open = false }
  }, [owner])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!owner) return null

  const run = async (task: (request: Request) => Promise<void>) => {
    const request = gateway()
    if (!request) return
    setBusy(true); setError(''); setNotice('')
    try { await task(request) } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const create = () => {
    if (state?.active && !window.confirm(uiText(REPLACE_CONFIRM))) return
    void run(async (request) => {
      setKey('')
      setCopied(false)
      const answer = await request('POST', KEY_PATH) as { key?: unknown; createdAt?: unknown } | null
      if (!answer) { setState(null); return }
      if (typeof answer.key !== 'string' || !KEY_SHAPE.test(answer.key)) throw new Error(UNEXPECTED)
      const createdAt = isoDate(answer.createdAt)
      setKey(answer.key)
      setState({ active: true, ...(createdAt ? { createdAt } : {}) })
    })
  }
  const revoke = () => void run(async (request) => {
    setKey('')
    setCopied(false)
    await request('DELETE', KEY_PATH)
    setState(keyState(await request('GET', KEY_PATH)))
    setNotice('Ключ отозван')
  })
  const copy = async () => {
    setNotice(''); setError('')
    try {
      await navigator.clipboard.writeText(key)
      setCopied(true)
    } catch {
      keyInput.current?.select()
      setError('Не удалось скопировать: выделите ключ и нажмите Ctrl+C.')
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const status = state === undefined ? uiText('Проверяем ключ…')
    : state === null ? uiText('Войдите в аккаунт владельца, чтобы управлять ключом.')
      : !state.active ? uiText('Ключа нет')
        : `${uiText('Ключ создан')}${state.createdAt ? ` ${when(state.createdAt)}` : ''} · ${state.lastUsedAt ? `${uiText('последнее чтение')} ${when(state.lastUsedAt)}` : uiText('ещё не использовался')}`

  return (
    <section className="panel requests-report claude-access" aria-labelledby={titleId}>
      <header className="requests-group-head">
        <div>
          <h2 id={titleId}><KeyRound size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Доступ Claude к заявкам')}</h2>
          <small className="dim">{uiText('Ключ только для чтения заявок: тексты, скриншоты, версии. Почт и аккаунтов в нём нет.')}</small>
        </div>
      </header>
      {(state !== undefined || !error) && <p className="dim" role="status" style={{ margin: 0 }}>{status}</p>}
      {key && (
        <div className="requests-detail">
          <label style={{ display: 'grid', gap: 4 }}>
            <span>{uiText('Новый ключ')}</span>
            <input ref={keyInput} className="input mono" readOnly value={key} autoComplete="off" spellCheck={false} onFocus={(event) => event.currentTarget.select()} style={{ width: '100%' }} />
          </label>
          <small>{uiText(SECRET_HINT)}</small>
          <small className="dim">{uiText('Ключ показан один раз: после закрытия панели его не увидеть.')}</small>
          <div className="requests-actions">
            <button type="button" className="button small primary" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}{uiText(copied ? 'Скопировано' : 'Скопировать')}</button>
            <button type="button" className="button small ghost" onClick={() => { setKey(''); setCopied(false) }}><EyeOff size={13} />{uiText('Скрыть ключ')}</button>
          </div>
        </div>
      )}
      <div className="requests-actions">
        <button type="button" className="button small" disabled={busy || !state} onClick={create}><KeyRound size={13} />{uiText(state?.active ? 'Заменить ключ' : 'Создать ключ')}</button>
        {state?.active && <button type="button" className="button small ghost" disabled={busy} onClick={revoke}><ShieldOff size={13} />{uiText('Отозвать')}</button>}
        {busy && <LoaderCircle size={14} className="spin" />}
        {notice && <small className="quest-text-saved">{uiText(notice)}</small>}
        {error && <small className="account-error" role="alert">{uiText(error)}</small>}
      </div>
    </section>
  )
}
