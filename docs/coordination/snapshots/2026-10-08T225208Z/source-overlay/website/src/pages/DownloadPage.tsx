import { Download } from 'lucide-react'
import { Notice } from '../components/Notice'
import { Platforms } from '../components/Platforms'
import { APP_VERSION, DOWNLOAD_AVAILABLE, DOWNLOAD_URL } from '../config'
import { stagger } from '../hooks/motion'

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
      Скачать для Windows
    </a>
  )
}

export function DownloadPage() {
  return (
    <div className="page">
      <div className="container narrow">
        <div className="panel download-card stagger" style={stagger(0)}>
          <div className="download-icon" aria-hidden="true"><Download /></div>
          <div className="eyebrow">Загрузка</div>
          <h1 className="page-title">Скачать приложение</h1>
          <p className="page-subtitle">Портативная версия для Windows — скачайте и запустите, установка не нужна.</p>
          <div className="download-meta">
            <span className="tag brass">Версия {APP_VERSION}</span>
            <span className="tag">Windows 10 / 11 · 64-bit</span>
            <span className="tag green">Бета</span>
          </div>
          <DownloadButton />
          <Platforms />
          {!DOWNLOAD_AVAILABLE && (
            <Notice tone="info" title="Ссылка скоро появится">Файл сборки ещё не опубликован. Как только релиз выйдет, кнопка начнёт скачивание.</Notice>
          )}
        </div>
      </div>
    </div>
  )
}
