import { FileText } from 'lucide-react'
import { tr } from '../i18n'
import { AndroidIcon, AppleIcon } from './Platforms'
import { ANDROID_DOWNLOAD_URL, IPHONE_DOWNLOAD_URL, IPHONE_GUIDE_URL, megabytes, useMobileRelease } from './mobileRelease'

/**
 * «Приложение для телефона» on the download page: the Android APK as one file (it updates itself from the site
 * afterwards), the iPhone archive with the app, the PDF guide and shortcuts to iTunes and Sideloadly. The buttons wait
 * until the server holds the builds (server/src/services/mobileDownloads.ts).
 */
export function MobileDownloads() {
  const release = useMobileRelease()
  const android = release?.android
  const iphone = release?.iphone
  return (
    <section className="panel mobile-downloads" aria-labelledby="mobile-downloads-title">
      <div className="eyebrow">{tr('Телефон')}</div>
      <h2 id="mobile-downloads-title">{tr('Приложение для телефона')}</h2>
      <p className="page-subtitle">{tr('Квесты, карты и прогресс с компьютера всегда под рукой. Нужна подписка Raid OS.')}</p>
      <div className="mobile-downloads-grid">
        <article className="mobile-download">
          <div className="mobile-download-head"><AndroidIcon /><strong>Android</strong>{android && <span className="tag">{tr('Версия {version}', { version: android.versionName })} · {megabytes(android.size)}</span>}</div>
          <p>{tr('Скачайте файл APK на телефон и откройте его. Android попросит разрешить установку из браузера — разрешите. Дальше приложение обновляется само.')}</p>
          <a className="button primary" href={android ? ANDROID_DOWNLOAD_URL : undefined} aria-disabled={!android} rel="noopener" download>
            <AndroidIcon />{tr(android ? 'Скачать для Android (APK)' : 'Скоро')}
          </a>
        </article>
        <article className="mobile-download">
          <div className="mobile-download-head"><AppleIcon /><strong>iPhone</strong>{iphone && <span className="tag">{megabytes(iphone.size)}</span>}</div>
          <p>{tr('Ставится с компьютера Windows через бесплатную программу Sideloadly. В архиве — приложение, пошаговая инструкция в PDF и ярлыки для скачивания iTunes и Sideloadly.')}</p>
          <a className="button primary" href={iphone ? IPHONE_DOWNLOAD_URL : undefined} aria-disabled={!iphone} rel="noopener" download>
            <AppleIcon />{tr(iphone ? 'Скачать для iPhone (архив)' : 'Скоро')}
          </a>
          <a className="button ghost small" href={IPHONE_GUIDE_URL} target="_blank" rel="noopener"><FileText aria-hidden="true" />{tr('Инструкция по установке (PDF)')}</a>
        </article>
      </div>
    </section>
  )
}
