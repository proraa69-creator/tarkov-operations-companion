import { Download } from 'lucide-react'
import { Notice } from '../components/Notice'
import { Platforms } from '../components/Platforms'
import { DonateCard } from '../components/DonateCard'
import { MobileDownloads } from '../components/MobileDownloads'
import { APP_VERSION, DOWNLOAD_AVAILABLE, DOWNLOAD_URL } from '../config'
import { stagger } from '../hooks/motion'
import { tr } from '../i18n'

export function DownloadButton({ large = true }: { large?: boolean }) {
  return (
    <a
      className={`button primary${large ? ' large' : ''}`}
      href={DOWNLOAD_URL}
      aria-disabled={!DOWNLOAD_AVAILABLE}
      onClick={(event) => { if (!DOWNLOAD_AVAILABLE) event.preventDefault() }}
      rel="noopener"
      download="RaidOSClient.exe"
    >
      <Download aria-hidden="true" />
      {tr('Скачать для Windows')}
    </a>
  )
}

export function DownloadPage() {
  return (
    <div className="page">
      <div className="container narrow">
        <div className="panel download-card stagger" style={stagger(0)}>
          <div className="download-icon" aria-hidden="true"><Download /></div>
          <div className="eyebrow">{tr('Загрузка')}</div>
          <h1 className="page-title">{tr('Скачать приложение')}</h1>
          <p className="page-subtitle">{tr('Портативная версия для Windows — скачайте и запустите, установка не нужна.')}</p>
          {/* Owner, 14.10.2026: right under the portable line. */}
          <p className="download-note">{tr('Используйте приложение осознанно: мы не можем давать юридических или античит-гарантий от имени Battlestate Games.')}</p>
          <div className="download-meta">
            <span className="tag brass">{tr('Версия {version}', { version: APP_VERSION })}</span>
            <span className="tag">Windows 10 / 11 · 64-bit</span>
            <span className="tag green">{tr('Бета')}</span>
          </div>
          <DownloadButton />
          <Platforms />
          {!DOWNLOAD_AVAILABLE && (
            <Notice tone="info" title={tr('Ссылка скоро появится')}>{tr('Файл сборки ещё не опубликован. Как только релиз выйдет, кнопка начнёт скачивание.')}</Notice>
          )}
        </div>
        {/* The phone apps (owner, 19.10.2026: «Android — просто файл APK, iPhone — архив с инструкцией»). */}
        <div className="stagger" style={stagger(1)}><MobileDownloads /></div>
        {/* «Поддержать проект» (owner, 13.10.2026). */}
        <div className="download-donate stagger" style={stagger(2)}><DonateCard /></div>
      </div>
    </div>
  )
}
