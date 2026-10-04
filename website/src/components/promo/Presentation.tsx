import { Archive, BookOpen, Crosshair, Download, Layers, LayoutDashboard, MonitorSmartphone, ShieldCheck, Skull, Smartphone, Tag, UserRound, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Reveal } from '../Reveal'
import {
  BallisticsVisual, BossesVisual, CollectorVisual, ItemPriceVisual, ModesVisual, OverviewVisual, PhoneVisual, SquadVisual,
  StoryVisual, SyncVisual,
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
 * The home page presentation below the hero. Every claim here was checked against the app code. The copy does not
 * explain how the app gets its data (owner's request, 04.10.2026): only what the player sees. The map tools and the
 * minimap / route sections were taken off the page; the phone app is not in the stores yet (docs/mobile.md) — «скоро».
 */
const FEATURES: Feature[] = [
  {
    id: 'overview',
    icon: <LayoutDashboard />,
    eyebrow: 'Вкладка «Обзор»',
    title: 'Квесты подтягиваются сами',
    lead: 'Приняли задание в игре — оно уже на «Обзоре», а Raid OS собирает план на выбранную карту.',
    points: [
      'Текущие задания на выбранной карте и приоритет карт по их числу',
      '«Требования рейда»: ключи, маркеры и предметы, которые нужно взять с собой',
    ],
    visual: <OverviewVisual />,
  },
  {
    id: 'item-price',
    icon: <Tag />,
    eyebrow: 'Цена прямо в рейде',
    title: 'Продать или оставить?',
    lead: 'Наведите курсор на предмет, дождитесь подсказки игры и нажмите горячую клавишу — Raid OS покажет, сколько он стоит.',
    points: [
      'Цена на барахолке и у лучшего торговца в одной карточке',
      'Пометка «Каппа»: предмет нужен для задания «Коллекционер»',
    ],
    visual: <ItemPriceVisual />,
  },
  {
    id: 'story',
    icon: <BookOpen />,
    eyebrow: 'Сюжетные квесты',
    title: 'Каждый этап — на своём месте',
    lead: 'Сюжетные главы разложены по этапам: что делать сейчас и что потом. Прогресс по сюжетным квестам синхронизируется автоматически — отмечать ничего не нужно.',
    points: [
      'Автоматическая синхронизация по сюжетным квестам: глава и текущий этап обновляются сами',
      '«Показать на карте» ведёт к локации текущего этапа',
      'Прогресс общий для ПК и телефона через аккаунт',
    ],
    visual: <StoryVisual />,
  },
  {
    id: 'collector',
    icon: <Archive />,
    eyebrow: 'Путь к Каппе',
    title: '«Коллекционер» собирается сам',
    lead: 'Чек-лист «Коллекционера» показывает, сколько предметов осталось до контейнера «Каппа». Нажмите «Сканировать», пролистайте схрон — найденные предметы отметятся автоматически.',
    points: [
      'Автоматическая отметка: «Сканировать» и пролистать схрон',
      'Счётчик собранных предметов и список того, что ещё не найдено',
      'Отметить предмет можно и вручную',
      'Чек-лист общий для ПК и телефона через аккаунт',
    ],
    visual: <CollectorVisual />,
  },
  {
    id: 'modes',
    icon: <Layers />,
    eyebrow: 'Актуальные данные',
    title: 'PvP, PvE и Сезон — отдельно',
    lead: 'У каждого режима свой каталог, свой прогресс и свои цены. Переключились — всё приложение показывает выбранный режим.',
    points: [
      'Квесты и Каппа хранятся отдельно для каждого режима',
      'Каталог заданий, предметов и цен загружается для каждого режима свой',
    ],
    visual: <ModesVisual />,
  },
  {
    id: 'bosses',
    icon: <Skull />,
    eyebrow: 'Боссы',
    title: 'Знай, кто ждёт на локации',
    lead: 'Карточка каждого босса: где встречается, сколько здоровья в каждой части тела, чем вооружён и что можно с него забрать.',
    points: [
      'Здоровье по частям тела рядом с цифрами ЧВК',
      'Локации появления и метки боссов на картах',
      '3D-модель в галерее: покрутите и рассмотрите снаряжение',
    ],
    visual: <BossesVisual />,
  },
  {
    id: 'ballistics',
    icon: <Crosshair />,
    eyebrow: 'Баллистика',
    title: 'Какой патрон пробьёт броню',
    lead: 'Все патроны на одном графике пробития и урона. Выберите патрон — Raid OS покажет шанс пробить броню каждого класса и сколько выстрелов на это уйдёт.',
    points: [
      'График «пробитие — урон» по всем калибрам, фильтр по калибру',
      'Шанс пробития брони 1–6 класса при разной прочности',
      'Сколько выстрелов в среднем нужно, чтобы пробить броню',
      'Цена патрона на барахолке и у торговцев',
    ],
    visual: <BallisticsVisual />,
  },
  {
    id: 'mobile',
    icon: <Smartphone />,
    eyebrow: 'iOS и Android',
    title: 'Raid OS в телефоне — скоро',
    lead: 'Те же задания, карты и темы в мобильной раскладке. Телефон удобно держать рядом, пока на ПК идёт рейд.',
    points: [
      'Внизу экрана: «Обзор», «Задания», «Карты», «Мини Карта»',
      'Прогресс заданий и чек-лист Каппы — те же, что на ПК',
      'Вход по QR-коду с компьютера — без ввода пароля',
    ],
    visual: <PhoneVisual />,
  },
  {
    id: 'sync',
    icon: <MonitorSmartphone />,
    eyebrow: 'Общая синхронизация',
    title: 'ПК, сайт и телефон — один аккаунт',
    lead: 'Войдите один раз — прогресс заданий, чек-лист Каппы и настройки поедут за вами.',
    points: [
      'Прогресс с ПК сразу виден на телефоне и на сайте',
      'Телефон и сайт берут данные из аккаунта',
      'Вход по QR: одноразовый код на 2 минуты, пароль на телефоне не нужен',
    ],
    visual: <SyncVisual />,
  },
  {
    id: 'squad',
    icon: <Users />,
    eyebrow: 'Совместные квесты',
    title: 'Отряд закрывает квесты быстрее',
    lead: 'Соберите «Отряд» или добавьте друзей — Raid OS подскажет карту, где у группы больше всего общих дел.',
    points: [
      'Приоритет карт для группы: общие задания весят больше',
      'Порядок обхода целей на выбранной карте для всех',
      'Метка MATE на карточке предмета: он нужен другу или товарищу по отряду',
      'Приглашение ссылкой или QR-кодом, прогресс можно скрыть',
    ],
    visual: <SquadVisual />,
  },
]

function FeatureSection({ feature, index }: { feature: Feature; index: number }) {
  const number = String(index + 1).padStart(2, '0')
  return (
    <section className={`feature${index % 2 ? ' is-flip' : ''}`} id={feature.id} aria-labelledby={`${feature.id}-title`}>
      <Reveal className="feature-text">
        <div className="feature-eyebrow"><span className="feature-icon" aria-hidden="true">{feature.icon}</span><span className="feature-num">{number}</span>{feature.eyebrow}</div>
        <h2 className="feature-title" id={`${feature.id}-title`}>{feature.title}</h2>
        <p className="feature-lead">{feature.lead}</p>
        <ul className="feature-points">{feature.points.map((point) => <li key={point}>{point}</li>)}</ul>
        {feature.note && <p className="feature-note">{feature.note}</p>}
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
          <div className="eyebrow">Что внутри</div>
          <h2 className="promo-intro-title">Десять причин держать Raid&nbsp;OS открытым</h2>
          <p className="promo-intro-lead">Квесты, карты, цены и отряд — в одном окне рядом с игрой.</p>
        </Reveal>
        {FEATURES.map((feature, index) => <FeatureSection key={feature.id} feature={feature} index={index} />)}
      </div>

      <section className="promo-final" aria-labelledby="final-title">
        <div className="container">
          <Reveal className="final-card panel">
            <div className="eyebrow">Готовы к рейду?</div>
            <h2 className="final-title" id="final-title">Следующий рейд — уже с планом</h2>
            <p className="final-lead">Скачайте Raid OS для Windows, войдите в аккаунт — и квесты, карты и цены будут под рукой с первого захода.</p>
            <div className="hero-actions center">
              <Link to="/download" className="button primary large"><Download aria-hidden="true" />Скачать для Windows</Link>
              <Link to="/cabinet" className="button large"><UserRound aria-hidden="true" />Личный кабинет и подписка</Link>
            </div>
            <ul className="final-trust">
              <li><ShieldCheck aria-hidden="true" /><span><strong>Честная игра.</strong> Raid OS не нарушает правила Escape from Tarkov: не вмешивается в игру, не изменяет её файлы и не выполняет действия за игрока.</span></li>
              <li><MonitorSmartphone aria-hidden="true" /><span><strong>Работает рядом с игрой.</strong> Отдельное окно и оверлей поверх игры, Windows 10 и 11.</span></li>
            </ul>
          </Reveal>
        </div>
      </section>
    </div>
  )
}
