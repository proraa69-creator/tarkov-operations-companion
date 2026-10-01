import { LoaderCircle, Mail } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { EmailSignIn } from '../components/EmailAuth'
import { Notice } from '../components/Notice'
import { PhoneSignIn, useAuthConfig } from '../components/PhoneAuth'

/**
 * «Забыли пароль?»: a code to the account's e-mail (server/src/routes/email.ts) or to the phone number bound in the
 * cabinet (server/src/routes/phone.ts) → new password. Every session of the account ends; this browser is signed in
 * with the new password. Owner accounts may reset by e-mail (their primary factor) but never by SMS (the server sends
 * them no SMS).
 */
export function ResetPasswordPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const config = useAuthConfig()
  const [channel, setChannel] = useState<'email' | 'phone' | null>(null)

  if (auth.status === 'ready') return <Navigate to="/cabinet" replace />

  const done = () => navigate('/cabinet', { replace: true, state: { passwordReset: true } })
  const email = config?.emailEnabled === true
  const sms = config?.smsEnabled === true
  // E-mail first when it works; SMS as the alternative.
  const active = channel ?? (email ? 'email' : sms ? 'phone' : null)

  return (
    <div className="container auth-wrap page-in">
      <div className="panel auth-card">
        <div className="eyebrow">Аккаунт</div>
        <h1>Восстановление пароля</h1>
        {!config && <LoaderCircle className="spinner" aria-hidden="true" />}
        {config && !active && <>
          <Notice tone="info">Восстановление пароля по коду на этом сервере сейчас недоступно.</Notice>
          <p className="lead">Напишите в поддержку с e-mail, на который зарегистрирован аккаунт: контакты — на странице <Link to="/legal">«Реквизиты и документы»</Link>.</p>
        </>}
        {active === 'email' && <>
          <EmailSignIn purpose="reset" onDone={done} {...(sms ? { onBack: () => setChannel('phone'), backLabel: 'Восстановить по номеру телефона' } : {})} />
        </>}
        {active === 'phone' && <>
          <PhoneSignIn purpose="reset" onDone={done} />
          {email && <button type="button" className="button ghost block" style={{ marginTop: 10 }} onClick={() => setChannel('email')}><Mail aria-hidden="true" />Восстановить по e-mail</button>}
          <p className="auth-switch">Номер не привязан? {email ? 'Восстановите пароль по e-mail или напишите' : 'Напишите'} в поддержку: контакты — на странице <Link to="/legal">«Реквизиты и документы»</Link>.</p>
        </>}
        {active === 'email' && !sms && <p className="auth-switch">Нет доступа к почте? Напишите в поддержку: контакты — на странице <Link to="/legal">«Реквизиты и документы»</Link>.</p>}
        <p className="auth-switch">Вспомнили пароль? <Link to="/login">Войти</Link></p>
      </div>
    </div>
  )
}
