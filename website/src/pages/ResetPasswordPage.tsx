import { LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { useAuthConfig } from '../components/authConfig'
import { EmailSignIn } from '../components/EmailAuth'
import { Notice } from '../components/Notice'
import { tr } from '../i18n'

/** A translated sentence with a link in it: `{link}` in the phrase marks where the link goes. */
function withLink(text: string, link: ReactNode) {
  const [before, after = ''] = text.split('{link}')
  return <>{before}{link}{after}</>
}

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
        <div className="eyebrow">{tr('Аккаунт')}</div>
        <h1>{tr('Восстановление пароля')}</h1>
        {!config && <LoaderCircle className="spinner" aria-hidden="true" />}
        {config && !email && <>
          <Notice tone="info">{tr('Восстановление пароля по коду из письма на этом сервере сейчас недоступно.')}</Notice>
          <p className="lead">{withLink(tr('Напишите в поддержку с e-mail, на который зарегистрирован аккаунт: контакты — на странице {link}.'), <Link to="/legal">{tr('«Реквизиты и документы»')}</Link>)}</p>
        </>}
        {email && <>
          <EmailSignIn purpose="reset" onDone={done} />
          <p className="auth-switch">{withLink(tr('Нет доступа к почте? Напишите в поддержку: контакты — на странице {link}.'), <Link to="/legal">{tr('«Реквизиты и документы»')}</Link>)}</p>
        </>}
        <p className="auth-switch">{tr('Вспомнили пароль?')} <Link to="/login">{tr('Войти')}</Link></p>
      </div>
    </div>
  )
}
