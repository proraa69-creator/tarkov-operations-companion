import { Monitor } from 'lucide-react'
import { CopyButton } from '../components/CopyButton'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { tr } from '../i18n'
import { DownloadButton } from './DownloadPage'

/**
 * raidos.app/pc — the page the iPhone app links to (src/account/AppleSubscription.tsx PcAppCard, the sign-in screen;
 * owner, 09.11.2026: «ссылка в приложении, которая открывает закрытую, новую страницу, где нет упоминания об оплате.
 * Только упоминание скачать приложение для ПК, без него приложение не будет работать. Все.»). No site menu, plans,
 * prices, cabinet, donations or link home. Paying happens in the PC app, which opens the site's payment itself.
 */
export function PcAppPage() {
  const url = typeof window === 'undefined' ? 'https://raidos.app/pc' : `${window.location.origin}/pc`
  return (
    <div className="pc-app-page">
      <header className="pc-app-page-header">
        <span className="brand" aria-label="Raid OS">
          <img className="brand-mark brand-logo-tile" src="/brand/icon.svg" alt="" aria-hidden="true" />
          <span className="brand-text"><img className="brand-name brand-logo-name" src="/brand/name.svg" alt="Raid OS" /></span>
        </span>
        <div className="pc-app-page-lang"><LanguageSwitch /></div>
      </header>
      <main className="page">
        <div className="container narrow">
          <div className="panel download-card">
            <div className="download-icon" aria-hidden="true"><Monitor /></div>
            <h1 className="page-title">{tr('Скачайте Raid OS для ПК')}</h1>
            <p className="page-subtitle">{tr('Без приложения для ПК Raid OS не работает.')}</p>
            <DownloadButton />
            <p className="pc-app-page-phone">{tr('Читаете с телефона? Откройте эту страницу на компьютере.')}</p>
            <div className="pc-app-page-copy"><code>{url.replace(/^https?:\/\//, '')}</code><CopyButton value={url} label="Скопировать ссылку" /></div>
          </div>
          <p className="pc-app-page-note">{tr('Неофициальный фанатский проект. Escape from Tarkov — товарный знак Battlestate Games; проект с ней не связан.')}</p>
        </div>
      </main>
    </div>
  )
}
