import { Mail, Send } from 'lucide-react'
import { SupportWidget } from '../components/SupportWidget'
import { tr } from '../i18n'
import '../extras.css'

/**
 * /support — the support page the App Store card links to (owner, 17.11.2026: «Дай мне отдельную ссылку для App Store с
 * поддержкой, окно поддержки»): the chat open on the page, the e-mail and Telegram. Like /app/privacy, without the site's
 * header, menu or footer, so nothing on it leads to plans or payments.
 */
export function SupportPage() {
  return (
    <main className="page app-privacy support-page">
      <div className="container narrow">
        <h1 className="page-title">{tr('Поддержка Raid OS')}</h1>
        <p className="page-subtitle">{tr('Напишите вопрос в чат — ответим здесь. Без аккаунта можно писать как гость и оставить почту для ответа.')}</p>
        <SupportWidget inline />
        <p className="support-page-contacts">
          <a href="mailto:raidosapp@gmail.com"><Mail size={16} aria-hidden="true" />raidosapp@gmail.com</a>
          <a href="https://t.me/raidosapp" target="_blank" rel="noreferrer"><Send size={16} aria-hidden="true" />@raidosapp</a>
        </p>
      </div>
    </main>
  )
}
