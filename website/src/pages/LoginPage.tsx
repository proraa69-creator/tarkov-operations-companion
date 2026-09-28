import { LoaderCircle, LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ApiError, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Notice } from '../components/Notice'

export function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  if (auth.status === 'ready') return <Navigate to="/cabinet" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await auth.login(email, password)
      navigate('/cabinet', { replace: true })
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container auth-wrap page-in">
      <div className="panel auth-card">
        <div className="eyebrow">Аккаунт</div>
        <h1>Вход</h1>
        <p className="lead">Войдите, чтобы открыть личный кабинет.</p>
        <form className="form" onSubmit={submit} noValidate={false}>
          {error !== null && (
            <Notice tone={error instanceof ApiError && error.network ? 'offline' : 'error'}>{errorMessage(error)}</Notice>
          )}
          <label className="field">
            <span className="field-label">E-mail</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label className="field">
            <span className="field-label">Пароль</span>
            <input className="input" type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" className="button primary large block" disabled={busy}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </form>
        <p className="auth-switch">Нет аккаунта? <Link to="/register">Зарегистрироваться</Link></p>
      </div>
    </div>
  )
}
