import { Cookie } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import '../extras.css'

const KEY = 'toc.cookie-notice'
function seen() {
  try { return window.localStorage.getItem(KEY) === '1' } catch { return false }
}

/** One-time notice: the site keeps only the sign-in token and the invitation code in the browser, no tracking. */
export function CookieNotice() {
  const [hidden, setHidden] = useState(seen)
  if (hidden) return null
  const close = () => {
    try { window.localStorage.setItem(KEY, '1') } catch { /* storage unavailable: the notice just shows again */ }
    setHidden(true)
  }
  return (
    <div className="cookie-notice" role="region" aria-label="Уведомление о хранилище браузера">
      <Cookie aria-hidden="true" />
      <p>Сайт не использует рекламные cookie и счётчики. В браузере хранится только вход в аккаунт и код приглашения. <Link to="/legal/cookies">Подробнее</Link></p>
      <button type="button" className="button small" onClick={close}>Понятно</button>
    </div>
  )
}
