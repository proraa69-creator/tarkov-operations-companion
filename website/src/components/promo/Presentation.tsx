import { Archive, Download, Hammer, House, LayoutDashboard, Map as MapIcon, MonitorSmartphone, Palette, RefreshCw, ShieldCheck, Skull, Tag, TrendingUp, UserRound, Users, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { tr } from '../../i18n'
import { LoginQr } from '../LoginQr'
import { Reveal } from '../Reveal'
import { ItemMapVisual } from './ItemMapVisual'
import {
  BossesVisual, CollectorVisual, GunsmithVisual, HideoutQuestsVisual, MapsVisual, OverviewVisual, SquadVisual, TradingVisual,
  WeaponBuildsVisual,
} from './PromoVisuals'
import '../../promo.css'

interface Feature {
  id: string
  icon: ReactNode
  eyebrow: string
  title: string
  lead?: string
  points: string[]
  visual: ReactNode
  note?: string
}

/**
 * The home page presentation below the hero: ten reasons with real pictures of the current app, then three more in a short
 * list (owner, 10.11.2026: «удали режимы, баллистика… автообновления не вноси в эти причины, темы и синхронизацию…
 * сделай просто в этом списке как дополнение»; «добавь ещё какой-нибудь раздел… чтобы было 10 причин»). Every claim was
 * checked against the app code; the copy does not explain how the app gets its data (04.10.2026); nothing of the app is
 * drawn over the game (15.10.2026).
 */
const FEATURES: Feature[] = [
  {
    id: 'overview',
    icon: <LayoutDashboard />,
    eyebrow: 'Обзор',
    title: 'Квесты синхронизируются сами',
    lead: 'Приняли задание в игре — оно уже на «Обзоре». Raid OS собирает план рейда на выбранную карту.',
    points: [
      'Приоритет карт: где больше всего ваших заданий',
      'Сбор на рейд и задания для Каппы',
      'Отслеживание Кочевников',
      'Требования рейда: ключи и то, что нужно заложить, и чего нет в наличии',
    ],
    visual: <OverviewVisual />,
  },
  {
    id: 'item-on-map',
    icon: <Tag />,
    eyebrow: 'Предмет и точка на карте',
    title: 'Информация о предмете в приложении на ПК и в телефоне',
    lead: 'Наведите курсор на предмет в игре и нажмите горячую клавишу — карточка появится на ПК и в телефоне. Скриншот в рейде ставит вашу точку на карту.',
    points: [
      'Цена на барахолке и у лучшего торговца',
      'Нужен ли предмет для Каппы',
      'Ваша точка с направлением взгляда, место и этаж',
      'Поверх игры ничего не рисуется',
    ],
    visual: <ItemMapVisual />,
  },
  {
    id: 'maps',
    icon: <MapIcon />,
    eyebrow: 'Карты',
    title: 'Живые карты всех локаций',
    lead: 'Спутниковая карта каждой локации со всеми точками — по этажам.',
    points: [
      'Выходы ЧВК и диких, переходы',
      'Спавны ЧВК и диких',
      'Лут и ключи с настоящими картинками',
      'Квестовые точки и кнопка «Нужные ключи»',
    ],
    visual: <MapsVisual />,
  },
  {
    id: 'collector',
    icon: <Archive />,
    eyebrow: 'Путь к Каппе',
    title: '«Коллекционер» под контролем',
    points: [
      'Все 44 предмета с картинками',
      'Отметьте собранное или сфотографируйте схрон на экране',
      'Список общий с приложением для ПК',
      'Пометка «Каппа» в карточке предмета',
    ],
    visual: <CollectorVisual />,
  },
  {
    id: 'squad',
    icon: <Users />,
    eyebrow: 'Отряд',
    title: 'Общие квесты на картах',
    lead: 'Соберите отряд или добавьте друзей — Raid OS покажет квесты каждого по картам, где они совпадают и с какой карты начать.',
    points: [
      'Квесты каждого участника по картам',
      'Общие квесты — у кого совпадают',
      'Сколько квестов у каждого на карте',
      'С какой карты начать вместе',
      'PvP, PvE и Сезон — раздельно',
      'Приглашение ссылкой или QR-кодом',
    ],
    visual: <SquadVisual />,
  },
  {
    id: 'gunsmith',
    icon: <Wrench />,
    eyebrow: 'Оружейник',
    title: 'Сборки для квестов «Оружейник»',
    lead: 'На «Обзоре» — часть «Оружейника», которую вы взяли.',
    points: [
      'Детали с картинками и ценами',
      'Кто продаёт деталь и с какого уровня торговца',
      'Нужные характеристики: эргономика, отдача, вес',
      'Чем можно заменить модуль',
    ],
    visual: <GunsmithVisual />,
  },
  {
    id: 'bosses',
    icon: <Skull />,
    eyebrow: 'Боссы',
    title: 'Боссы в 3D и тактика боя',
    lead: 'Карточка каждого босса.',
    points: [
      '3D-модели: покрутите и рассмотрите снаряжение',
      'Тактика боя: как действует, слабые места и план боя',
      'Здоровье, вооружение и лут',
      'Карты, где он появляется',
    ],
    visual: <BossesVisual />,
  },
  {
    id: 'trading',
    icon: <TrendingUp />,
    eyebrow: 'Торговля',
    title: 'Купить дешевле, продать дороже',
    lead: 'Статистика цен барахолки по вашему режиму: что сейчас выгодно и когда продавать.',
    points: [
      'График цены за неделю и прогноз',
      'Сколько можно заработать с учётом комиссии',
      'Что подешевело и что подорожало',
      'Уведомление, когда пора продавать',
    ],
    visual: <TradingVisual />,
  },
  {
    id: 'hideout',
    icon: <House />,
    eyebrow: 'Убежище и квесты',
    title: 'Что собрать для убежища и квестов',
    lead: 'Все предметы для улучшений убежища и для квестов — с картинками и количеством.',
    points: [
      'Отметка «найдено в рейде»',
      'Для каких квестов нужен предмет',
      'Собранное отмечается кнопками «+» и «−»',
      'Круг сектантов: что положить, чтобы получить нужный предмет',
    ],
    visual: <HideoutQuestsVisual />,
  },
  {
    id: 'builds',
    icon: <Hammer />,
    eyebrow: 'Арсенал',
    title: 'Сборка оружия',
    lead: 'Нажмите на ячейку и выберите модуль: подходят только совместимые, характеристики и цена считаются сразу.',
    points: [
      'Эргономика, отдача, вес и цена',
      'Список покупок по торговцам',
      'Сохраняйте свои сборки',
      'Публикуйте сборки — их увидят другие игроки',
    ],
    visual: <WeaponBuildsVisual />,
  },
]

/** The short list after the reasons (owner, 10.11.2026): auto-update, themes and sync, without pictures of their own. */
const EXTRAS = [
  { id: 'updates', icon: <RefreshCw />, title: 'Автообновление', text: 'Новая версия скачивается сама, проверяется и ставится — не посреди рейда.' },
  { id: 'themes', icon: <Palette />, title: 'Темы', text: 'Олива, Чёрный мультикам, Металл, Тельняшка и Снаряжение — в один клик.' },
  { id: 'sync', icon: <MonitorSmartphone />, title: 'Синхронизация', text: 'ПК, сайт и телефон — одна база: прогресс, Каппа и настройки везде. Вход на телефоне по QR-коду.' },
]

function FeatureSection({ feature, index }: { feature: Feature; index: number }) {
  const number = String(index + 1).padStart(2, '0')
  return (
    <section className={`feature${index % 2 ? ' is-flip' : ''}`} id={feature.id} aria-labelledby={`${feature.id}-title`}>
      <Reveal className="feature-text">
        <div className="feature-eyebrow"><span className="feature-icon" aria-hidden="true">{feature.icon}</span><span className="feature-num">{number}</span>{tr(feature.eyebrow)}</div>
        <h2 className="feature-title" id={`${feature.id}-title`}>{tr(feature.title)}</h2>
        {feature.lead && <p className="feature-lead">{tr(feature.lead)}</p>}
        <ul className="feature-points">{feature.points.map((point) => <li key={point}>{tr(point)}</li>)}</ul>
        {feature.note && <p className="feature-note">{tr(feature.note)}</p>}
      </Reveal>
      <Reveal className="feature-visual" delay={120}>{feature.visual}</Reveal>
    </section>
  )
}

function Extras() {
  const downloadUrl = typeof window === 'undefined' ? '/download' : `${window.location.origin}/download`
  return (
    <section className="promo-extras" aria-labelledby="extras-title">
      <Reveal className="promo-extras-card">
        <h2 className="promo-extras-title" id="extras-title">{tr('И ещё')}</h2>
        <div className="promo-extras-grid">
          <ul className="promo-extras-list">
            {EXTRAS.map((extra) => (
              <li key={extra.id} id={extra.id}>
                <span className="feature-icon" aria-hidden="true">{extra.icon}</span>
                <div><strong>{tr(extra.title)}</strong><p>{tr(extra.text)}</p></div>
              </li>
            ))}
          </ul>
          <div className="promo-extras-qr">
            <div className="promo-extras-qr-code"><LoginQr value={downloadUrl} size={132} label={tr('QR-код со ссылкой на страницу загрузки Raid OS')} /></div>
            <p>{tr('Даже если вы сыграли 10 000 часов, Raid OS сэкономит вам время на сборе в рейд.')}</p>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

export function Presentation() {
  return (
    <div className="promo">
      <div className="container">
        <Reveal className="promo-intro">
          <div className="eyebrow">{tr('Что внутри')}</div>
          <h2 className="promo-intro-title">{tr('Десять причин держать Raid OS открытым')}</h2>
          <p className="promo-intro-lead">{tr('Квесты, карты, цены и отряд — в одном окне.')}</p>
        </Reveal>
        {FEATURES.map((feature, index) => <FeatureSection key={feature.id} feature={feature} index={index} />)}
        <Extras />
      </div>

      <section className="promo-final" aria-labelledby="final-title">
        <div className="container">
          <Reveal className="final-card panel">
            <div className="eyebrow">{tr('Готовы к рейду?')}</div>
            <h2 className="final-title" id="final-title">{tr('Следующий рейд — уже с планом')}</h2>
            <p className="final-lead">{tr('Скачайте Raid OS для Windows, войдите в аккаунт — и квесты, карты и цены будут под рукой с первого захода.')}</p>
            <div className="hero-actions center">
              <Link to="/download" className="button primary large"><Download aria-hidden="true" />{tr('Скачать для Windows')}</Link>
              <Link to="/cabinet" className="button large"><UserRound aria-hidden="true" />{tr('Личный кабинет и подписка')}</Link>
            </div>
            <ul className="final-trust">
              <li><ShieldCheck aria-hidden="true" /><span><strong>{tr('Честная игра.')}</strong> {tr('Raid OS не нарушает правила Escape from Tarkov: не вмешивается в игру, не изменяет её файлы и не выполняет действия за игрока.')}</span></li>
              <li><MonitorSmartphone aria-hidden="true" /><span><strong>{tr('Отдельное окно и телефон.')}</strong></span></li>
            </ul>
          </Reveal>
        </div>
      </section>
    </div>
  )
}
