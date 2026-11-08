import { CheckCircle2, Monitor } from 'lucide-react'
import { CopyButton } from '../components/CopyButton'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { APP_VERSION } from '../config'
import { tr } from '../i18n'
import { DownloadButton } from './DownloadPage'

/**
 * raidos.app/pc — «Raid OS для Windows», the page the iPhone app links to (src/account/AppleSubscription.tsx PcAppCard;
 * owner, 09.11.2026: «Можно указать «Скачайте наше приложение для ПК» и указать ссылку на скачивание»). The download and
 * what the PC app does, nothing else: no site menu, plans, prices, cabinet or donations, and the brand is no link — outside
 * the United States storefront an iPhone app may not lead to other ways to pay (App Store guideline 3.1.1(a)), and Apple's
 * reviewer opens the links. Payment stays where it was: in the PC app and on the rest of the site.
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
            <div className="eyebrow">{tr('Raid OS для Windows')}</div>
            <h1 className="page-title">{tr('Raid OS на компьютере')}</h1>
            <ul className="pc-app-page-points">
              <li><CheckCircle2 aria-hidden="true" />{tr('Задания отмечаются сами по логам игры')}</li>
              <li><CheckCircle2 aria-hidden="true" />{tr('Ваша точка на карте по скриншоту из игры')}</li>
              <li><CheckCircle2 aria-hidden="true" />{tr('Один аккаунт на компьютере и в телефоне')}</li>
            </ul>
            <div className="download-meta">
              <span className="tag brass">{tr('Версия {version}', { version: APP_VERSION })}</span>
              <span className="tag">Windows 10 / 11 · 64-bit</span>
            </div>
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
