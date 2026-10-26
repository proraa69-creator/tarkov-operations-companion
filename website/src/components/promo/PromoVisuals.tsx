import { Globe, Monitor, Server, Smartphone } from 'lucide-react'
import { siteLocale, tr } from '../../i18n'
import { LoginQr } from '../LoginQr'
import overviewShot from '../../assets/promo/overview.webp'
import mapItem from '../../assets/promo/map-item.webp'
import mapPosition from '../../assets/promo/map-position.webp'
import gunsmithParts from '../../assets/promo/gunsmith-parts.webp'
import modePvp from '../../assets/promo/mode-pvp.webp'
import modePve from '../../assets/promo/mode-pve.webp'
import modeSeason from '../../assets/promo/mode-season.webp'
import kappaShot from '../../assets/promo/kappa.webp'
import squadShot from '../../assets/promo/squad-board.webp'
import bossShot from '../../assets/promo/boss-tagilla.webp'
import ballisticsShot from '../../assets/promo/ballistics.webp'
import updateShot from '../../assets/promo/update.webp'
import themeTarkov from '../../assets/promo/theme-tarkov.webp'
import themeBlackmc from '../../assets/promo/theme-blackmc.webp'
import themeSlate from '../../assets/promo/theme-slate.webp'
import themeTelnyashka from '../../assets/promo/theme-telnyashka.webp'
import themeGear from '../../assets/promo/theme-gear.webp'
import phoneLive from '../../assets/promo/phone-live.webp'
import bustReshala from '../../assets/promo/bust-reshala.webp'
import bustKilla from '../../assets/promo/bust-killa.webp'
import bustTagilla from '../../assets/promo/bust-tagilla.webp'
import bustGlukhar from '../../assets/promo/bust-glukhar.webp'
import bustShturman from '../../assets/promo/bust-shturman.webp'
import bustSanitar from '../../assets/promo/bust-sanitar.webp'
import bustKaban from '../../assets/promo/bust-kaban.webp'
import bustZryachiy from '../../assets/promo/bust-zryachiy.webp'
import overviewShotEn from '../../assets/promo/overview-en.webp'
import mapItemEn from '../../assets/promo/map-item-en.webp'
import mapPositionEn from '../../assets/promo/map-position-en.webp'
import gunsmithPartsEn from '../../assets/promo/gunsmith-parts-en.webp'
import modePvpEn from '../../assets/promo/mode-pvp-en.webp'
import modePveEn from '../../assets/promo/mode-pve-en.webp'
import modeSeasonEn from '../../assets/promo/mode-season-en.webp'
import squadShotEn from '../../assets/promo/squad-board-en.webp'
import bossShotEn from '../../assets/promo/boss-tagilla-en.webp'
import ballisticsShotEn from '../../assets/promo/ballistics-en.webp'
import updateShotEn from '../../assets/promo/update-en.webp'
import themeTarkovEn from '../../assets/promo/theme-tarkov-en.webp'
import themeBlackmcEn from '../../assets/promo/theme-blackmc-en.webp'
import themeSlateEn from '../../assets/promo/theme-slate-en.webp'
import themeTelnyashkaEn from '../../assets/promo/theme-telnyashka-en.webp'
import themeGearEn from '../../assets/promo/theme-gear-en.webp'
import phoneLiveEn from '../../assets/promo/phone-live-en.webp'

/** The screenshot in the site language: the app's Russian or English interface (scripts/trailer/capture.mjs, TRAILER_LOCALE=en). */
const shot = (ru: string, en: string) => (siteLocale() === 'en' ? en : ru)

/**
 * Pictures of the home page presentation, the same shots as the trailer: real screens of the current desktop app with
 * its demo data (scripts/trailer/capture.mjs, 11.10.2026), no game art — the map image is a neutral survey grid. «Карты»
 * and «Оружейник» show the live tarkov.dev catalog (item and part pictures, prices of 16.10.2026; the Gunsmith build
 * picture is the app's). Nothing of the app is drawn over the game (15.10.2026). Everything else here is plain HTML/CSS.
 * All images are local (the site CSP allows only 'self').
 */

function Shot({ src, alt, width, height, title, className = '' }: { src: string; alt: string; width: number; height: number; title?: string; className?: string }) {
  return (
    <div className={`shot ${className}`}>
      {title && <div className="shot-bar" aria-hidden="true"><i /><i /><i /><span>{title}</span></div>}
      <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
    </div>
  )
}

export function OverviewVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(overviewShot, overviewShotEn)} width={1200} height={675} title={tr('Raid OS · Обзор')} alt={tr('Вкладка «Обзор» в Raid OS: приоритет карт, Кочевники, план рейда на Таможню, текущие задания и предметы, требуемые в рейде')} />
    </figure>
  )
}

/** The item card on «Карты», top left under «Вид» (the app's MapItemCard). */
export function MapItemVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(mapItem, mapItemEn)} width={1200} height={676} title={tr('Raid OS · Карты')} alt={tr('Карточка предмета на «Картах»: золотое яйцо с пометкой «Каппа», цены барахолки и Терапевта')} />
    </figure>
  )
}

/** The player's point on «Карты» and the same point on the phone. */
export function PositionVisual() {
  return (
    <figure className="promo-figure position-figure">
      <div className="position-map">
        <Shot src={shot(mapPosition, mapPositionEn)} width={1200} height={676} title={tr('Raid OS · Карты · Таможня')} alt={tr('Точка игрока с направлением взгляда на карте Таможни в приложении, рядом квестовые точки')} />
        <span className="position-you" aria-hidden="true">{tr('Вы здесь')}</span>
      </div>
      <div className="phone-frame is-small position-phone"><img src={shot(phoneLive, phoneLiveEn)} width={520} height={1015} loading="lazy" decoding="async" alt={tr('Та же точка на карте в телефоне')} /></div>
    </figure>
  )
}

/** «Оружейник»: the build of the part taken, its parts with pictures and prices, who sells them. */
export function GunsmithVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(gunsmithParts, gunsmithPartsEn)} width={1000} height={880} title={tr('Оружейник · M4A1')} className="is-narrow" alt={tr('Страница «Оружейник»: сборка M4A1, нужные характеристики, детали с картинками и ценами и кто их продаёт')} />
    </figure>
  )
}

export function CollectorVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={kappaShot} width={1200} height={251} title={tr('Предметы для «Коллекционера»')} className="is-strip" alt={tr('Чек-лист предметов для «Коллекционера»: собранные предметы отмечены, кнопка «Сканировать»')} />
    </figure>
  )
}

const MODE_SHOTS = [
  { label: 'PvP', src: [modePvp, modePvpEn] as const },
  { label: 'PvE', src: [modePve, modePveEn] as const },
  { label: 'Сезон', src: [modeSeason, modeSeasonEn] as const },
]

export function ModesVisual() {
  return (
    <figure className="promo-figure">
      <div className="modes-stack" role="img" aria-label={tr('«Обзор» в режимах PvP, PvE и Сезон: у каждого свой прогресс')}>
        {MODE_SHOTS.map((mode, index) => (
          <div key={mode.label} className={`modes-card is-${index}`} aria-hidden="true">
            <span className="modes-card-label">{tr(mode.label)}</span>
            <img src={shot(...mode.src)} width={900} height={506} loading="lazy" decoding="async" alt="" />
          </div>
        ))}
      </div>
    </figure>
  )
}

/** Totals and maps as the app shows them (src/data/bossLoadout.ts, src/data/bossFigures.ts). */
const BOSSES = [
  { name: 'Решала', hp: 752, maps: 'Таможня · Терминал', src: bustReshala },
  { name: 'Килла', hp: 890, maps: 'Развязка · Лабиринт · Терминал', src: bustKilla },
  { name: 'Тагилла', hp: 1220, maps: 'Развязка · Завод · Терминал', src: bustTagilla },
  { name: 'Глухарь', hp: 1010, maps: 'Резерв · Терминал', src: bustGlukhar },
  { name: 'Штурман', hp: 812, maps: 'Лес', src: bustShturman },
  { name: 'Санитар', hp: 1270, maps: 'Берег · Терминал', src: bustSanitar },
  { name: 'Кабан', hp: 1300, maps: 'Улицы Таркова', src: bustKaban },
  { name: 'Зрячий', hp: 1655, maps: 'Маяк', src: bustZryachiy },
]

export function BossesVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(bossShot, bossShotEn)} width={1200} height={675} title={tr('Боссы · Тагилла')} alt={tr('Раздел «Боссы»: 3D-модель Тагиллы и карточка здоровья по частям тела рядом с цифрами ЧВК')} />
      <ul className="boss-grid" aria-label={tr('Основные боссы')}>
        {BOSSES.map((boss) => (
          <li key={boss.name}>
            <img src={boss.src} width={128} height={128} loading="lazy" decoding="async" alt={tr('Бюст босса {name}', { name: tr(boss.name) })} />
            <strong>{tr(boss.name)}</strong>
            <span className="boss-hp">{boss.hp} HP</span>
            <span className="boss-maps">{tr(boss.maps)}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function BallisticsVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(ballisticsShot, ballisticsShotEn)} width={1200} height={763} title={tr('Арсенал · Баллистика')} alt={tr('Баллистика в Raid OS: график пробития и урона патронов и таблица «Против брони» — шанс пробить броню 1–6 класса')} />
    </figure>
  )
}

export function UpdateVisual() {
  return (
    <figure className="promo-figure">
      <div className="scene update-scene">
        <img className="update-shot" src={shot(updateShot, updateShotEn)} width={720} height={363} loading="lazy" decoding="async" alt={tr('Окно автообновления Raid OS: новая версия скачивается и ставится при запуске')} />
      </div>
    </figure>
  )
}

const THEMES = [
  { name: 'Олива', src: [themeTarkov, themeTarkovEn] as const },
  { name: 'Чёрный мультикам', src: [themeBlackmc, themeBlackmcEn] as const },
  { name: 'Металл', src: [themeSlate, themeSlateEn] as const },
  { name: 'Тельняшка', src: [themeTelnyashka, themeTelnyashkaEn] as const },
  { name: 'Снаряжение', src: [themeGear, themeGearEn] as const },
]

export function ThemesVisual() {
  return (
    <figure className="promo-figure">
      <ul className="themes-grid">
        {THEMES.map((theme) => (
          <li key={theme.name}>
            <img src={shot(...theme.src)} width={640} height={360} loading="lazy" decoding="async" alt={tr('«Обзор» в теме «{name}»', { name: tr(theme.name) })} />
            <span>{tr(theme.name)}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function SyncVisual() {
  const downloadUrl = typeof window === 'undefined' ? '/download' : `${window.location.origin}/download`
  return (
    <figure className="promo-figure">
      <div className="sync-mock">
        <div className="sync-devices" role="img" aria-label={tr('Схема: приложение для ПК, сайт и телефон связаны через один аккаунт на сервере Raid OS')}>
          <div className="sync-node"><Monitor aria-hidden="true" /><strong>{tr('ПК')}</strong></div>
          <div className="sync-node"><Globe aria-hidden="true" /><strong>{tr('Сайт')}</strong></div>
          <div className="sync-node"><Smartphone aria-hidden="true" /><strong>{tr('Телефон')}</strong></div>
          <div className="sync-hub"><Server aria-hidden="true" /><strong>{tr('Один аккаунт')}</strong></div>
        </div>
        <div className="sync-live">
          <div className="phone-frame is-small"><img src={shot(phoneLive, phoneLiveEn)} width={520} height={1015} loading="lazy" decoding="async" alt={tr('Карта на телефоне: местоположение игрока с ПК')} /></div>
          <div className="sync-qr">
            <LoginQr value={downloadUrl} size={120} label={tr('QR-код со ссылкой на страницу загрузки Raid OS')} />
            <p><strong>{tr('Вход по QR')}</strong></p>
          </div>
        </div>
      </div>
    </figure>
  )
}

export function SquadVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(squadShot, squadShotEn)} width={1200} height={412} title={tr('Отряд · Квесты по картам')} alt={tr('Отряд в Raid OS: квесты каждого участника по картам и общие квесты — у кого они совпадают')} />
    </figure>
  )
}
