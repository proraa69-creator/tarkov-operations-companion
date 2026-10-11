import { Archive, Crosshair, Download, Layers, LayoutDashboard, MapPinned, MonitorSmartphone, Palette, RefreshCw, ShieldCheck, Skull, Smartphone, Tag, UserRound, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { tr } from '../../i18n'
import { Reveal } from '../Reveal'
import {
  BallisticsVisual, BossesVisual, CollectorVisual, ItemPriceVisual, MinimapVisual, ModesVisual, OverviewVisual, PhoneVisual, SquadVisual,
  SyncVisual, ThemesVisual, UpdateVisual,
} from './PromoVisuals'
import '../../promo.css'

interface Feature {
  id: string
  icon: ReactNode
  eyebrow: string
  title: string
  lead: string
  points: string[]
  visual: ReactNode
  note?: string
}

/**
 * The home page presentation below the hero: the twelve scenes of the trailer (scripts/trailer/README.md, the owner's
 * storyboard of 10.10.2026) in the same order and words, with screenshots of the current app (scripts/trailer/capture.mjs
 * → src/assets/promo, owner 11.10.2026: «обнови все пункты согласно нашему видео»). Every claim was checked against
 * the app code; the copy does not explain how the app gets its data (04.10.2026); the phone app is «скоро».
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
      'Отслеживание Кочевников',
      'Текущие задания и карта со всеми точками квестов',
      'Предметы, требуемые в рейде: ключи, маркеры и то, что нужно заложить',
    ],
    visual: <OverviewVisual />,
  },
  {
    id: 'item-price',
    icon: <Tag />,
    eyebrow: 'Цена в рейде',
    title: 'Продать или оставить?',
    lead: 'Наведите курсор на предмет в игре и нажмите горячую клавишу — её можно повесить и на боковую кнопку мыши. Карточка покажет, сколько он стоит.',
    points: [
      'Цена на барахолке и у лучшего торговца',
      'Пометка «Каппа»: предмет нужен для «Коллекционера»',
      'Метка MATE: предмет нужен другу, а у напарника из отряда — его ник',
    ],
    visual: <ItemPriceVisual />,
  },
  {
    id: 'modes',
    icon: <Layers />,
    eyebrow: 'Режимы',
    title: 'PvP, PvE и Сезон — у каждого своя база',
    lead: 'Переключились — и всё приложение показывает выбранный режим.',
    points: [
      'Свой прогресс заданий и Каппы',
      'Свои задания',
      'Свои цены на барахолке',
    ],
    visual: <ModesVisual />,
  },
  {
    id: 'collector',
    icon: <Archive />,
    eyebrow: 'Путь к Каппе',
    title: '«Коллекционер» собирается сам',
    lead: 'Нажмите «Сканировать» и пролистайте схрон — найденные предметы отметятся сами.',
    points: [
      'Синхронизация из схрона',
      'Что уже собрано и что осталось',
      'Цена и пометка «Каппа» прямо в рейде',
    ],
    visual: <CollectorVisual />,
  },
  {
    id: 'squad',
    icon: <Users />,
    eyebrow: 'Отряд',
    title: 'Общие квесты на картах',
    lead: 'Соберите отряд или добавьте друзей — Raid OS покажет квесты каждого по картам и где они совпадают.',
    points: [
      'Состав отряда',
      'Квесты каждого по картам',
      'У кого квесты совпадают',
      'Приглашение ссылкой или QR-кодом',
    ],
    visual: <SquadVisual />,
  },
  {
    id: 'bosses',
    icon: <Skull />,
    eyebrow: 'Боссы',
    title: 'Боссы в 3D и их здоровье',
    lead: 'Карточка каждого босса: 3D-модель, здоровье по частям тела, вооружение, лут и тактика боя.',
    points: [
      '3D-модели: покрутите и рассмотрите снаряжение',
      'HP по частям тела рядом с цифрами ЧВК',
      'Вооружение, лут и «Тактика боя»',
    ],
    visual: <BossesVisual />,
  },
  {
    id: 'ballistics',
    icon: <Crosshair />,
    eyebrow: 'Патроны и барахолка',
    title: 'Какой патрон пробьёт броню',
    lead: 'Все патроны на одном графике пробития и урона, а рядом — цены барахолки для вашего режима.',
    points: [
      'Пробитие и урон всех патронов',
      'Шанс пробить броню 1–6 класса',
      'Цены барахолки по режиму',
    ],
    visual: <BallisticsVisual />,
  },
  {
    id: 'minimap',
    icon: <MapPinned />,
    eyebrow: 'Мини-карта',
    title: 'Мини-карта поверх игры',
    lead: 'Карта прямо поверх окна игры — не нужно сворачивать игру, чтобы свериться с ней.',
    points: [
      'Ваша позиция на карте',
      'Квестовые точки рядом',
      'Этажи зданий и прозрачность',
      'Горячие клавиши — и на кнопки мыши',
    ],
    visual: <MinimapVisual />,
  },
  {
    id: 'updates',
    icon: <RefreshCw />,
    eyebrow: 'Обновления',
    title: 'Автообновление — всегда свежая версия',
    lead: 'Новая версия ставится при запуске приложения, а не посреди рейда.',
    points: [
      'Обновляется само',
      'Настройки и прогресс сохраняются',
    ],
    visual: <UpdateVisual />,
  },
  {
    id: 'themes',
    icon: <Palette />,
    eyebrow: 'Темы',
    title: 'Смена темы — в один клик',
    lead: 'Кнопка палитры в верхней панели переключает оформление всего приложения.',
    points: [
      'Олива, Чёрный мультикам, Металл, Тельняшка и Снаряжение',
      'Выбранная тема запоминается',
    ],
    visual: <ThemesVisual />,
  },
  {
    id: 'mobile',
    icon: <Smartphone />,
    eyebrow: 'Телефон',
    title: 'Приложение на iOS и Android — скоро',
    lead: 'Те же задания и карты в мобильной раскладке: телефон удобно держать рядом, пока на ПК идёт рейд.',
    points: [
      'Вход по QR-коду с компьютера — без пароля',
      'Те же задания и карты',
    ],
    visual: <PhoneVisual />,
  },
  {
    id: 'sync',
    icon: <MonitorSmartphone />,
    eyebrow: 'Синхронизация',
    title: 'ПК · сайт · телефон — одна база',
    lead: 'Войдите один раз — прогресс, чек-лист Каппы и настройки будут везде.',
    points: [
      'Полная синхронизация',
      'Моментальное местоположение на телефоне',
      'Вся информация везде',
    ],
    visual: <SyncVisual />,
  },
]

function FeatureSection({ feature, index }: { feature: Feature; index: number }) {
  const number = String(index + 1).padStart(2, '0')
  return (
    <section className={`feature${index % 2 ? ' is-flip' : ''}`} id={feature.id} aria-labelledby={`${feature.id}-title`}>
      <Reveal className="feature-text">
        <div className="feature-eyebrow"><span className="feature-icon" aria-hidden="true">{feature.icon}</span><span className="feature-num">{number}</span>{tr(feature.eyebrow)}</div>
        <h2 className="feature-title" id={`${feature.id}-title`}>{tr(feature.title)}</h2>
        <p className="feature-lead">{tr(feature.lead)}</p>
        <ul className="feature-points">{feature.points.map((point) => <li key={point}>{tr(point)}</li>)}</ul>
        {feature.note && <p className="feature-note">{tr(feature.note)}</p>}
      </Reveal>
      <Reveal className="feature-visual" delay={120}>{feature.visual}</Reveal>
    </section>
  )
}

export function Presentation() {
  return (
    <div className="promo">
      <div className="container">
        <Reveal className="promo-intro">
          <div className="eyebrow">{tr('Что внутри')}</div>
          <h2 className="promo-intro-title">{tr('Двенадцать причин держать Raid\u00a0OS открытым')}</h2>
          <p className="promo-intro-lead">{tr('Квесты, карты, цены и отряд — в одном окне рядом с игрой.')}</p>
        </Reveal>
        {FEATURES.map((feature, index) => <FeatureSection key={feature.id} feature={feature} index={index} />)}
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
              <li><MonitorSmartphone aria-hidden="true" /><span><strong>{tr('Работает рядом с игрой.')}</strong> {tr('Отдельное окно и оверлей поверх игры, Windows 10 и 11.')}</span></li>
            </ul>
          </Reveal>
        </div>
      </section>
    </div>
  )
}
