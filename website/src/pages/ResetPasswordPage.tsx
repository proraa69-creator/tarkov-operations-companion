import { LoaderCircle } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Notice } from '../components/Notice'
import { PhoneSignIn, SMS_OFF_TEXT, useAuthConfig } from '../components/PhoneAuth'

/**
 * «Забыли пароль?»: the number bound in the cabinet → SMS code → new password (server/src/routes/phone.ts). Every
 * session of the account ends; this browser is signed in with the new password. Owner accounts are excluded on the
 * server (no SMS is sent to them).
 */
export function ResetPasswordPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const config = useAuthConfig()

  if (auth.status === 'ready') return <Navigate to="/cabinet" replace />

  return (
    <div className="container auth-wrap page-in">
      <div className="panel auth-card">
        <div className="eyebrow">Аккаунт</div>
        <h1>Восстановление пароля</h1>
        {!config && <LoaderCircle className="spinner" aria-hidden="true" />}
        {config && !config.smsEnabled && <>
          <Notice tone="info">{SMS_OFF_TEXT}</Notice>
          <p className="lead">Напишите в поддержку с e-mail, на который зарегистрирован аккаунт: контакты — на странице <Link to="/legal">«Реквизиты и документы»</Link>.</p>
        </>}
        {config?.smsEnabled && <>
          <PhoneSignIn purpose="reset" onDone={() => navigate('/cabinet', { replace: true, state: { passwordReset: true } })} />
          <p className="auth-switch">Номер не привязан? Напишите в поддержку: контакты — на странице <Link to="/legal">«Реквизиты и документы»</Link>.</p>
        </>}
        <p className="auth-switch">Вспомнили пароль? <Link to="/login">Войти</Link></p>
      </div>
    </div>
  )
}
