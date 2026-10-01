import { KeyRound, LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Notice } from './Notice'

/** Cabinet: «Сменить пароль» — the current password, then the new one; other sessions end. */
export function PasswordPanel() {
  const auth = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!auth.token) return
    if (next.length < 8) { setResult({ ok: false, message: 'Новый пароль должен быть не короче 8 символов.' }); return }
    if (next !== repeat) { setResult({ ok: false, message: 'Пароли не совпадают.' }); return }
    setBusy(true); setResult(null)
    try {
      const answer = await api.changePassword(auth.token, current, next)
      auth.adopt(answer.token, answer.account)
      setCurrent(''); setNext(''); setRepeat('')
      setResult({ ok: true, message: 'Пароль изменён. Входы на других устройствах завершены.' })
    } catch (reason) {
      setResult({ ok: false, message: errorMessage(reason) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="password-title">
      <div className="panel-header">
        <div className="panel-title" id="password-title"><KeyRound aria-hidden="true" />Пароль</div>
      </div>
      <form className="panel-body form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Текущий пароль</span>
          <input className="input" type="password" autoComplete="current-password" required maxLength={128} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Новый пароль</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Повторите новый пароль</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
        {result && <Notice tone={result.ok ? 'success' : 'error'}>{result.message}</Notice>}
        <div><button type="submit" className="button primary" disabled={busy || !current || !next}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}Сменить пароль</button></div>
      </form>
    </section>
  )
}
