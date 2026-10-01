import { LoaderCircle } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { useAuthConfig } from '../components/authConfig'
import { EmailSignIn } from '../components/EmailAuth'
import { Notice } from '../components/Notice'

/**
 * «Забыли пароль?»: a code to the account's e-mail (server/src/routes/email.ts) → new password. Every session of the
 * account ends; this browser is signed in with the new password. Without e-mail codes on the server: support only.
 */
export function ResetPasswordPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const config = useAuthConfig()

  if (auth.status === 'ready') return <Navigate to="/cabinet" replace />

  const done = () => navigate('/cabinet', { replace: true, state: { passwordReset: true } })
  const email = config?.emailEnabled === true

  return (
    <div className="container auth-wrap page-in">
      <div className="panel auth-card">
        <div className="eyebrow">Аккаунт</div>
        <h1>Восстановление пароля</h1>
        {!config && <LoaderCircle className="spinner" aria-hidden="true" />}
        {config && !email && <>
          <Notice tone="info">Восстановление пароля по коду из письма на этом сервере сейчас недоступно.</Notice>
          <p className="lead">Напишите в поддержку с e-mail, на который зарегистрирован аккаунт: контакты — на странице <Link to="/legal">«Реквизиты и документы»</Link>.</p>
        </>}
        {email && <>
          <EmailSignIn purpose="reset" onDone={done} />
          <p className="auth-switch">Нет доступа к почте? Напишите в поддержку: контакты — на странице <Link to="/legal">«Реквизиты и документы»</Link>.</p>
        </>}
        <p className="auth-switch">Вспомнили пароль? <Link to="/login">Войти</Link></p>
      </div>
    </div>
  )
}
