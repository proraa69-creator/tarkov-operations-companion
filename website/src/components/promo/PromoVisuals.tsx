import { siteLocale, tr } from '../../i18n'
import overviewShot from '../../assets/promo/overview.webp'
import overviewShotEn from '../../assets/promo/overview-en.webp'
import mapsLive from '../../assets/promo/maps-live.webp'
import mapsLiveEn from '../../assets/promo/maps-live-en.webp'
import kappaItems from '../../assets/promo/kappa-items.webp'
import kappaItemsEn from '../../assets/promo/kappa-items-en.webp'
import squadShot from '../../assets/promo/squad-board.webp'
import squadShotEn from '../../assets/promo/squad-board-en.webp'
import gunsmithParts from '../../assets/promo/gunsmith-parts.webp'
import gunsmithPartsEn from '../../assets/promo/gunsmith-parts-en.webp'
import bossTactics from '../../assets/promo/boss-tactics.webp'
import bossTacticsEn from '../../assets/promo/boss-tactics-en.webp'
import tradingShot from '../../assets/promo/trading.webp'
import tradingShotEn from '../../assets/promo/trading-en.webp'
import hideoutQuests from '../../assets/promo/hideout-quests.webp'
import hideoutQuestsEn from '../../assets/promo/hideout-quests-en.webp'
import weaponBuilds from '../../assets/promo/weapon-builds.webp'
import weaponBuildsEn from '../../assets/promo/weapon-builds-en.webp'
import bustReshala from '../../assets/promo/bust-reshala.webp'
import bustKilla from '../../assets/promo/bust-killa.webp'
import bustTagilla from '../../assets/promo/bust-tagilla.webp'
import bustGlukhar from '../../assets/promo/bust-glukhar.webp'
import bustShturman from '../../assets/promo/bust-shturman.webp'
import bustSanitar from '../../assets/promo/bust-sanitar.webp'
import bustKaban from '../../assets/promo/bust-kaban.webp'
import bustZryachiy from '../../assets/promo/bust-zryachiy.webp'

/** The screenshot in the site language: the app's Russian or English interface. */
const shot = (ru: string, en: string) => (siteLocale() === 'en' ? en : ru)

/**
 * Pictures of the home page presentation: real screens of the current desktop app (owner, 10.11.2026: «с реальными
 * картинками… снимками карт, не просто квадратики, сетка пустая, а именно прям карту живую»). «Обзор» is the owner's own
 * app (PvE, Таможня); the rest is the app in PvE with the live catalog, item pictures, the satellite map, the server's
 * own «Торговля» statistics and the bosses' «Тактика боя». Every image is local (the site CSP allows only 'self').
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
      <Shot src={shot(overviewShot, overviewShotEn)} width={1600} height={946} title={tr('Raid OS · Обзор')} alt={tr('Вкладка «Обзор» в Raid OS: приоритет карт, Кочевники, план рейда на Таможню, текущие задания и предметы, требуемые в рейде')} />
    </figure>
  )
}

export function MapsVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(mapsLive, mapsLiveEn)} width={1400} height={735} title={tr('Raid OS · Карты · Таможня')} alt={tr('Спутниковая карта Таможни в Raid OS: выходы, спавны, лут, ключи и квестовые точки')} />
    </figure>
  )
}

export function CollectorVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(kappaItems, kappaItemsEn)} width={1400} height={626} title={tr('Raid OS · Предметы для «Коллекционера»')} alt={tr('Все 44 предмета для «Коллекционера» с картинками: собранные отмечены, счётчик 17 из 44')} />
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

/** «Оружейник»: the build of the part taken, its parts with pictures and prices, who sells them. */
export function GunsmithVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(gunsmithParts, gunsmithPartsEn)} width={1000} height={880} title={tr('Оружейник · M4A1')} className="is-narrow" alt={tr('Страница «Оружейник»: сборка M4A1, нужные характеристики, детали с картинками и ценами и кто их продаёт')} />
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

/** Tagilla's 3D model and, on the right, his «Тактика боя» page (owner, 10.11.2026: «справа от Тагиллы не хп, а тактика боя»). */
export function BossesVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(bossTactics, bossTacticsEn)} width={1400} height={788} title={tr('Боссы · Тагилла')} alt={tr('Раздел «Боссы»: 3D-модель Тагиллы и его «Тактика боя» — как действует и план боя')} />
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

export function TradingVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(tradingShot, tradingShotEn)} width={1400} height={883} title={tr('Raid OS · Торговля · PvE')} alt={tr('«Торговля» в Raid OS: график цены предмета за неделю, прогноз, когда продавать, сколько можно заработать, и список выгодных предметов')} />
    </figure>
  )
}

export function HideoutQuestsVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(hideoutQuests, hideoutQuestsEn)} width={1400} height={865} title={tr('Raid OS · Убежище и квесты')} alt={tr('«Что собрать для квестов»: предметы с картинками и количеством, отметка «найдено в рейде», торговцы и для каких квестов нужен предмет')} />
    </figure>
  )
}

export function WeaponBuildsVisual() {
  return (
    <figure className="promo-figure">
      <Shot src={shot(weaponBuilds, weaponBuildsEn)} width={1400} height={713} title={tr('Raid OS · Сборка оружия')} alt={tr('«Сборка оружия»: M4A1 с модулями по ячейкам, эргономика, отдача и цена, кнопки «Сохранить» и «Опубликовать»')} />
    </figure>
  )
}
