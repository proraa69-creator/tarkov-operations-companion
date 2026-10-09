import { Globe, Monitor, Server, Smartphone } from 'lucide-react'
import type { ReactNode } from 'react'
import { LoginQr } from '../LoginQr'
import { Platforms } from '../Platforms'
import overviewShot from '../../assets/promo/overview.webp'
import itemKappa from '../../assets/promo/item-kappa.webp'
import itemMate from '../../assets/promo/item-mate.webp'
import storyShot from '../../assets/promo/story.webp'
import kappaShot from '../../assets/promo/kappa.webp'
import bossShot from '../../assets/promo/boss-killa.webp'
import ballisticsShot from '../../assets/promo/ballistics.webp'
import phoneShot from '../../assets/promo/phone-overview.webp'
import bustReshala from '../../assets/promo/bust-reshala.webp'
import bustKilla from '../../assets/promo/bust-killa.webp'
import bustTagilla from '../../assets/promo/bust-tagilla.webp'
import bustGlukhar from '../../assets/promo/bust-glukhar.webp'
import bustShturman from '../../assets/promo/bust-shturman.webp'
import bustSanitar from '../../assets/promo/bust-sanitar.webp'
import bustKaban from '../../assets/promo/bust-kaban.webp'
import bustZryachiy from '../../assets/promo/bust-zryachiy.webp'

/**
 * Pictures of the home page presentation. Screenshots are real screens of the desktop app rendered with its demo data
 * (scripts like scripts/trailer/capture.mjs): no game art — the map image is a neutral survey grid and item icons are a
 * neutral tile. Everything else here is plain HTML/CSS. All images are local (the site CSP allows only 'self').
 */

function Shot({ src, alt, width, height, title, className = '' }: { src: string; alt: string; width: number; height: number; title?: string; className?: string }) {
  return (
    <div className={`shot ${className}`}>
      {title && <div className="shot-bar" aria-hidden="true"><i /><i /><i /><span>{title}</span></div>}
      <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
    </div>
  )
}

function Caption({ children }: { children: ReactNode }) {
  return <figcaption className="promo-caption">{children}</figcaption>
}

export function OverviewVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={overviewShot} width={1200} height={638} title="Raid OS · Обзор" alt="Вкладка «Обзор» в Raid OS: план рейда на Таможню, текущие задания, приоритет карт и прогресс Каппы" />
    </figure>
  )
}

export function ItemPriceVisual() {
  return (
    <figure className="promo-figure">
      <div className="scene stash-scene">
        <div className="stash-grid" aria-hidden="true">
          {Array.from({ length: 40 }, (_, index) => <span key={index} className={index === 13 ? 'is-hover' : undefined} />)}
        </div>
        <div className="key-hint" aria-hidden="true"><span>наведите курсор</span><kbd>;</kbd></div>
        <img className="item-card-shot" src={itemKappa} width={560} height={149} loading="lazy" decoding="async" alt="Карточка предмета в рейде: «Потрёпанная старинная книга», пометка «Каппа», цены барахолки и Терапевта" />
      </div>
      <Caption>«Потрёпанная старинная книга» — один из предметов для задания «Коллекционер». Цены на картинке — пример.</Caption>
    </figure>
  )
}

export function StoryVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={storyShot} width={1200} height={742} title="Задания · сюжет" alt="Сюжетные квесты в Raid OS: глава «Тур», актуальный этап 1 из 22 и список этапов главы" />
    </figure>
  )
}

export function CollectorVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={kappaShot} width={1200} height={251} title="Предметы для «Коллекционера»" className="is-strip" alt="Чек-лист предметов для «Коллекционера»: собрано 4 из 10, кнопка «Сканировать»" />
    </figure>
  )
}

const MODES = ['PvP', 'PvE', 'Сезон']

export function ModesVisual() {
  return (
    <figure className="promo-figure">
      <div className="modes-mock" role="img" aria-label="Переключатель режимов PvP, PvE и Сезон">
        <div className="modes-switch" aria-hidden="true">{MODES.map((mode, index) => <span key={mode} className={index === 0 ? 'is-on' : undefined}>{mode}</span>)}</div>
      </div>
      <Caption>Переключатель режимов в верхней панели приложения меняет все разделы сразу.</Caption>
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
      <Shot src={bossShot} width={1200} height={921} title="Галерея · Килла" alt="Карточка босса Киллы: 3D-модель, локации Развязка, Лабиринт и Терминал, здоровье по частям тела — 890 HP рядом с цифрами ЧВК" />
      <ul className="boss-grid" aria-label="Основные боссы">
        {BOSSES.map((boss) => (
          <li key={boss.name}>
            <img src={boss.src} width={128} height={128} loading="lazy" decoding="async" alt={`Бюст босса ${boss.name}`} />
            <strong>{boss.name}</strong>
            <span className="boss-hp">{boss.hp} HP</span>
            <span className="boss-maps">{boss.maps}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function BallisticsVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={ballisticsShot} width={1200} height={1229} title="Арсенал · Баллистика" className="is-narrow" alt="Баллистика в Raid OS: график пробития и урона патронов по калибрам и таблица «Против брони» для 7.62×39 BP — шанс пробить броню 1–6 класса и число выстрелов" />
      <Caption>7.62×39 BP против брони 1–6 класса. На картинке — часть патронов, в приложении — все патроны игры.</Caption>
    </figure>
  )
}

export function PhoneVisual() {
  return (
    <figure className="promo-figure phone-figure">
      <div className="phone-frame">
        <span className="phone-badge">скоро</span>
        <img src={phoneShot} width={520} height={1125} loading="lazy" decoding="async" alt="Мобильная раскладка Raid OS: переключатель PvP, PvE и Сезон, текущие задания и прогресс Каппы, нижнее меню «Обзор», «Задания», «Карты», «Мини Карта»" />
      </div>
      <div className="phone-side">
        <Platforms align="start" />
        <p>Мобильная версия собрана из того же кода, что и приложение для ПК. В App Store и Google Play её пока нет — когда появится, ссылки будут на странице загрузки.</p>
      </div>
    </figure>
  )
}

export function SyncVisual() {
  const downloadUrl = typeof window === 'undefined' ? '/download' : `${window.location.origin}/download`
  return (
    <figure className="promo-figure">
      <div className="sync-mock">
        <div className="sync-devices" role="img" aria-label="Схема: приложение для ПК, сайт и телефон связаны через один аккаунт на сервере Raid OS">
          <div className="sync-node"><Monitor aria-hidden="true" /><strong>ПК</strong><span>квесты, сюжет, Каппа</span></div>
          <div className="sync-node"><Globe aria-hidden="true" /><strong>Сайт</strong><span>кабинет и подписка</span></div>
          <div className="sync-node"><Smartphone aria-hidden="true" /><strong>Телефон</strong><span>прогресс и мини-карта</span></div>
          <div className="sync-hub"><Server aria-hidden="true" /><strong>Один аккаунт</strong></div>
        </div>
        <div className="sync-qr">
          <LoginQr value={downloadUrl} size={132} label="QR-код со ссылкой на страницу загрузки Raid OS" />
          <p><strong>Вход по QR</strong>В приложении так входят на телефоне: код живёт 2 минуты и срабатывает один раз. Этот код — просто ссылка на страницу загрузки.</p>
        </div>
      </div>
    </figure>
  )
}

const SQUAD = [
  { name: 'Вы', hue: 0, note: '5 заданий на Таможне' },
  { name: 'Бобр', hue: 1, note: '3 общих задания' },
  { name: 'Сойка', hue: 2, note: '2 общих задания' },
]
const PRIORITY = [
  { map: 'Таможня', value: 9 },
  { map: 'Развязка', value: 5 },
  { map: 'Лес', value: 3 },
]

export function SquadVisual() {
  return (
    <figure className="promo-figure">
      <div className="squad-mock">
        <div className="squad-card" role="img" aria-label="Пример отряда из трёх игроков и приоритет карт: Таможня — больше всего общих заданий">
          <div className="squad-card-head" aria-hidden="true"><strong>Отряд</strong><span>PvP</span></div>
          <ul aria-hidden="true">
            {SQUAD.map((member) => (
              <li key={member.name}><span className={`squad-avatar hue-${member.hue}`}>{member.name[0]}</span><b>{member.name}</b><small>{member.note}</small></li>
            ))}
          </ul>
          <div className="squad-priority" aria-hidden="true">
            <span className="squad-priority-title">Приоритет карт для группы</span>
            {PRIORITY.map((row) => (
              <div key={row.map} className="squad-bar"><span>{row.map}</span><i style={{ width: `${(row.value / 9) * 100}%` }} /><em>{row.value}</em></div>
            ))}
          </div>
        </div>
        <img className="mate-card" src={itemMate} width={428} height={178} loading="lazy" decoding="async" alt="Карточка предмета «Аптечка Salewa» с фиолетовой меткой MATE: предмет нужен товарищу по отряду" />
      </div>
      <Caption>Пример отряда. Метка MATE — без имён: просто знак, что предмет кому-то из своих нужен.</Caption>
    </figure>
  )
}
