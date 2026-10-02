import { BookOpen, Crosshair, Database, Download, Layers, LayoutDashboard, MapPinned, MonitorSmartphone, ShieldCheck, Skull, Smartphone, Tag, UserRound, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Reveal } from '../Reveal'
import {
  BossesVisual, ItemPriceVisual, MapToolsVisual, MinimapVisual, ModesVisual, OverviewVisual, PhoneVisual, SquadVisual,
  StoryKappaVisual, SyncVisual,
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
 * The home page presentation below the hero. Every claim here was checked against the app code:
 * quests — EFT log files (electron/logScanner.ts); position — the coordinates EFT writes into a screenshot file name
 * (src/overlay/screenshotPosition.ts); item price — game tooltip recognised from the screen after a hotkey
 * (src/overlay/tooltipLookup.ts); map tools — src/components/MapTools.tsx; squad — src/squad/*. The phone app is not
 * in the stores yet (docs/mobile.md), so it is «скоро».
 */
const FEATURES: Feature[] = [
  {
    id: 'overview',
    icon: <LayoutDashboard />,
    eyebrow: 'Вкладка «Обзор»',
    title: 'Квесты подтягиваются сами',
    lead: 'Приняли задание в игре — оно уже на «Обзоре». Raid OS читает журналы EFT и собирает план на выбранную карту.',
    points: [
      'Автосинхронизация квестов по лог-файлам игры — без ручных галочек',
      'Текущие задания на выбранной карте и приоритет карт по их числу',
      '«Требования рейда»: ключи, маркеры и предметы, которые нужно взять с собой',
    ],
    visual: <OverviewVisual />,
  },
  {
    id: 'map-tools',
    icon: <Crosshair />,
    eyebrow: 'Рулетка и «Снайпер»',
    title: 'Дистанция — в метрах игры',
    lead: 'Измерьте путь до точки или посмотрите, какие позиции попадают в дальность вашего выстрела.',
    points: [
      'Рулетка: клик ставит точку, правая кнопка убирает последний отрезок',
      'Длина каждого отрезка и всего пути в метрах',
      '«Снайпер»: кольца каждые 50 м до 500 м вокруг прицела, прицел можно перетаскивать',
    ],
    visual: <MapToolsVisual />,
  },
  {
    id: 'minimap',
    icon: <MapPinned />,
    eyebrow: 'Мини-карта и маршрут',
    title: 'Где вы и куда дальше',
    lead: 'Нажмите в игре клавишу скриншота — мини-карта поверх игры поставит вас на карту и покажет активные задания этой локации.',
    points: [
      'Позиция обновляется по скриншоту в игре: EFT пишет координаты и направление взгляда в имя файла',
      'Окно поверх игры: прозрачность настраивается, вызывается горячей клавишей',
      'Маршрут ①→②→③→④→⑤: порядок обхода точек текущих заданий, старт можно указать на карте',
    ],
    note: 'Позиция — на момент последнего скриншота, а не непрерывное слежение.',
    visual: <MinimapVisual />,
  },
  {
    id: 'item-price',
    icon: <Tag />,
    eyebrow: 'Цена прямо в рейде',
    title: 'Продать или оставить?',
    lead: 'Наведите курсор на предмет, дождитесь подсказки игры и нажмите горячую клавишу — Raid OS узнает предмет по названию на экране.',
    points: [
      'Цена на барахолке и у лучшего торговца в одной карточке',
      'Пометка «Каппа»: предмет нужен для задания «Коллекционер»',
      '«НЕ ПРОДАВАТЬ»: сколько ещё нужно для квестов, убежища или Каппы и нужен ли FIR',
    ],
    visual: <ItemPriceVisual />,
  },
  {
    id: 'story-kappa',
    icon: <BookOpen />,
    eyebrow: 'Сюжет и путь к Каппе',
    title: 'Каждый этап — на своём месте',
    lead: 'Сюжетные главы разложены по этапам: что делать сейчас и что потом. Чек-лист «Коллекционера» считает, сколько осталось до контейнера «Каппа».',
    points: [
      'Глава и этап подхватываются с экрана игры, когда открыта вкладка заданий',
      '«Показать на карте» ведёт к локации текущего этапа',
      'Предметы для Каппы: отметьте вручную или нажмите «Сканировать» и пролистайте схрон',
      'Чек-лист общий для ПК и телефона через аккаунт',
    ],
    visual: <StoryKappaVisual />,
  },
  {
    id: 'modes',
    icon: <Layers />,
    eyebrow: 'Актуальные данные',
    title: 'PvP, PvE и Сезон — отдельно',
    lead: 'У каждого режима свой каталог, свой прогресс и свои цены. Переключились — всё приложение показывает выбранный режим.',
    points: [
      'Квесты, Каппа и «что не продавать» хранятся по режимам',
      'Каталог заданий, предметов и цен загружается для каждого режима свой',
      'База обновляется кнопкой в приложении — данные из открытых источников',
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
    id: 'mobile',
    icon: <Smartphone />,
    eyebrow: 'iOS и Android',
    title: 'Raid OS в телефоне — скоро',
    lead: 'Те же задания, карты и темы в мобильной раскладке. Телефон удобно держать рядом, пока на ПК идёт рейд.',
    points: [
      'Внизу экрана: «Обзор», «Задания», «Карты», «Мини Карта»',
      'Мини-карта на телефоне показывает позицию, которую передаёт приложение для ПК',
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
      'ПК отправляет то, что умеет читать только он: квесты из логов, позицию со скриншота',
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
            <p className="final-lead">Скачайте Raid OS для Windows, войдите в аккаунт — и квесты, маршрут и цены будут под рукой с первого захода.</p>
            <div className="hero-actions center">
              <Link to="/download" className="button primary large"><Download aria-hidden="true" />Скачать для Windows</Link>
              <Link to="/cabinet" className="button large"><UserRound aria-hidden="true" />Личный кабинет и подписка</Link>
            </div>
            <ul className="final-trust">
              <li><ShieldCheck aria-hidden="true" /><span><strong>Не вмешивается в игру.</strong> Не читает память и не внедряется в процесс EFT — только логи, скриншоты и экран.</span></li>
              <li><Database aria-hidden="true" /><span><strong>Открытые источники.</strong> Задания, предметы и цены — из tarkov.dev и вики игры.</span></li>
              <li><MonitorSmartphone aria-hidden="true" /><span><strong>Работает рядом с игрой.</strong> Отдельное окно и оверлей поверх игры, Windows 10 и 11.</span></li>
            </ul>
          </Reveal>
        </div>
      </section>
    </div>
  )
}
