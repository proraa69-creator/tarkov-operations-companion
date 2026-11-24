import { Globe, Monitor, MonitorSmartphone, Palette, RefreshCw, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { QrCode } from '../../../../src/components/QrCode'
import { siteLocale, tr } from '../../i18n'
import { Reveal } from '../Reveal'
import updateShot from '../../assets/promo/update-window.webp'
import updateShotEn from '../../assets/promo/update-window-en.webp'
import themeTarkov from '../../assets/promo/theme-tarkov.webp'
import themeTarkovEn from '../../assets/promo/theme-tarkov-en.webp'
import themeBlackmc from '../../assets/promo/theme-blackmc.webp'
import themeBlackmcEn from '../../assets/promo/theme-blackmc-en.webp'
import themeSlate from '../../assets/promo/theme-slate.webp'
import themeSlateEn from '../../assets/promo/theme-slate-en.webp'
import themeTelnyashka from '../../assets/promo/theme-telnyashka.webp'
import themeTelnyashkaEn from '../../assets/promo/theme-telnyashka-en.webp'
import themeGear from '../../assets/promo/theme-gear.webp'
import themeGearEn from '../../assets/promo/theme-gear-en.webp'
import syncPc from '../../assets/promo/overview.webp'
import syncPcEn from '../../assets/promo/overview-en.webp'
import syncSite from '../../assets/promo/sync-site.webp'
import syncSiteEn from '../../assets/promo/sync-site-en.webp'
import syncPhone from '../../assets/promo/item-phone.webp'
import syncPhoneEn from '../../assets/promo/item-phone-en.webp'
import './extras.css'

const shot = (ru: string, en: string) => (siteLocale() === 'en' ? en : ru)

const THEMES = [
  { id: 'tarkov', name: 'Олива', src: [themeTarkov, themeTarkovEn] as const },
  { id: 'blackmc', name: 'Чёрный мультикам', src: [themeBlackmc, themeBlackmcEn] as const },
  { id: 'slate', name: 'Металл', src: [themeSlate, themeSlateEn] as const },
  { id: 'telnyashka', name: 'Тельняшка', src: [themeTelnyashka, themeTelnyashkaEn] as const },
  { id: 'gear', name: 'Снаряжение', src: [themeGear, themeGearEn] as const },
]

function ThemePicker() {
  const [current, setCurrent] = useState(THEMES[0]!.id)
  const theme = THEMES.find((entry) => entry.id === current) ?? THEMES[0]!
  return (
    <div className="extras-themes">
      <div className="shot">
        <div className="shot-bar" aria-hidden="true"><i /><i /><i /><span>{tr('Raid OS · Обзор')}</span></div>
        <img src={shot(...theme.src)} width={1600} height={900} loading="lazy" decoding="async" alt={tr('«Обзор» в теме «{name}»', { name: tr(theme.name) })} />
      </div>
      <div className="extras-theme-list" role="radiogroup" aria-label={tr('Темы')}>
        {THEMES.map((entry) => (
          <button key={entry.id} type="button" role="radio" aria-checked={entry.id === current} className={entry.id === current ? 'is-on' : ''} onClick={() => setCurrent(entry.id)}>
            <img src={shot(...entry.src)} width={160} height={90} loading="lazy" decoding="async" alt="" />
            <span>{tr(entry.name)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SyncPicture() {
  const downloadUrl = typeof window === 'undefined' ? 'https://raidos.app/download' : `${window.location.origin}/download`
  return (
    <div className="extras-sync">
      <div className="extras-sync-devices">
        <figure className="extras-device is-pc">
          <img src={shot(syncPc, syncPcEn)} width={1600} height={946} loading="lazy" decoding="async" alt={tr('Приложение для ПК')} />
          <figcaption><Monitor aria-hidden="true" />{tr('ПК')}</figcaption>
        </figure>
        <figure className="extras-device is-site">
          <img src={shot(syncSite, syncSiteEn)} width={1440} height={900} loading="lazy" decoding="async" alt={tr('Сайт raidos.app')} />
          <figcaption><Globe aria-hidden="true" />{tr('Сайт')}</figcaption>
        </figure>
        <figure className="extras-device is-phone">
          <img src={shot(syncPhone, syncPhoneEn)} width={430} height={932} loading="lazy" decoding="async" alt={tr('Приложение для телефона')} />
          <figcaption><Smartphone aria-hidden="true" />{tr('Телефон')}</figcaption>
        </figure>
      </div>
      <div className="extras-sync-qr">
        <QrCode value={downloadUrl} size={150} label={tr('QR-код со ссылкой на страницу загрузки Raid OS')} />
        <span>{tr('Вход на телефоне по QR-коду')}</span>
      </div>
    </div>
  )
}

/**
 * «И ещё» after the ten reasons (owner, 10.11.2026): auto-update with the app's own update window, the themes as pictures
 * that change on a click, and the sync of PC, site and phone with the app's styled QR code.
 */
export function Extras() {
  return (
    <section className="promo-extras" aria-labelledby="extras-title">
      <Reveal><h2 className="promo-extras-title" id="extras-title">{tr('И ещё')}</h2></Reveal>
      <Reveal className="extras-row" >
        <div className="extras-text" id="updates">
          <span className="feature-icon" aria-hidden="true"><RefreshCw /></span>
          <h3>{tr('Автообновление')}</h3>
          <p>{tr('Новая версия скачивается сама, проверяется и ставится — не посреди рейда.')}</p>
        </div>
        <div className="shot">
          <div className="shot-bar" aria-hidden="true"><i /><i /><i /><span>{tr('Raid OS · Автообновление')}</span></div>
          <img src={shot(updateShot, updateShotEn)} width={1600} height={900} loading="lazy" decoding="async" alt={tr('Окно «Обновление до актуальной версии»: скачивание, проверка и установка')} />
        </div>
      </Reveal>
      <Reveal className="extras-row is-flip">
        <div className="extras-text" id="themes">
          <span className="feature-icon" aria-hidden="true"><Palette /></span>
          <h3>{tr('Темы')}</h3>
          <p>{tr('Олива, Чёрный мультикам, Металл, Тельняшка и Снаряжение — в один клик.')}</p>
        </div>
        <ThemePicker />
      </Reveal>
      <Reveal className="extras-row">
        <div className="extras-text" id="sync">
          <span className="feature-icon" aria-hidden="true"><MonitorSmartphone /></span>
          <h3>{tr('Синхронизация')}</h3>
          <p>{tr('ПК, сайт и телефон — одна база: прогресс, Каппа и настройки везде. Вход на телефоне по QR-коду.')}</p>
        </div>
        <SyncPicture />
      </Reveal>
    </section>
  )
}
