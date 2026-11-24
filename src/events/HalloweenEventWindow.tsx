import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Biohazard, ChevronRight, MapPin } from 'lucide-react'
import { useOptionalTarkovData } from '../data/DataProvider'
import { HALLOWEEN_2026, HALLOWEEN_QUEST_IDS, type CuratedQuest } from '../data/curatedQuests'
import { canonicalMapId, mapDisplayName } from '../data/mapIds'
import { QuestGuidePhotos } from '../components/QuestGuidePhotos'
import type { AppDataset, Quest } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'
import { HALLOWEEN_OPEN_EVENT, halloweenEventActive, useHalloweenActive } from './halloweenEvent'
import './halloweenEvent.css'

type Phrase = { ru: string; en: string }
type Lang = 'ru' | 'en'

const TEXT = {
  eyebrow: { ru: 'Ивент', en: 'Event' },
  title: { ru: 'Хеллоуин 2026', en: 'Halloween 2026' },
  close: { ru: 'Закрыть', en: 'Close' },
  story: {
    ru: 'С обновлением 1.3.0.0 (29 октября) из Лаборатории вырвалась инфекция. Лыжник и Терапевт по-разному берутся с ней бороться: у каждого своя цепочка заданий, и по ходу придётся выбрать сторону.',
    en: 'With update 1.3.0.0 (29 October) an infection broke out of the Lab. Skier and Therapist take it on in their own ways: each has a task line of his own, and along the way you have to pick a side.',
  },
  info: { ru: 'Главное об ивенте', en: 'The event in short' },
  quests: { ru: 'Задания ивента', en: 'Event tasks' },
  objectives: { ru: 'Цели', en: 'Objectives' },
  rewards: { ru: 'Награды', en: 'Rewards' },
  onMap: { ru: 'На карте', en: 'On the map' },
  openQuest: { ru: 'Открыть квест', en: 'Open the quest' },
}

/** The useful facts (owner: «просто инфа какая то полезная»), every one confirmed by two walkthroughs or the game's own data. */
const FACTS: Array<{ title: Phrase; text: Phrase }> = [
  {
    title: { ru: 'Когда', en: 'When' },
    text: {
      ru: 'С 29 октября. Дату окончания разработчики пока не объявили; приложение показывает ивент до 12 ноября.',
      en: 'Since 29 October. The developers have not announced the end yet; the app shows the event until 12 November.',
    },
  },
  {
    title: { ru: 'Заражённые локации', en: 'Infected locations' },
    text: {
      ru: '«Заражённый завод» и «Заражённая лаборатория» — отдельные ивентовые локации: на экране выбора локации переключитесь на ивентовые справа сверху. Точки их заданий приложение ставит на обычные карты Завода и Лаборатории.',
      en: 'The Infected Factory and the Infected Lab are separate event locations: switch to the event locations in the top right of the location screen. The app puts their tasks\' points on the ordinary Factory and Lab maps.',
    },
  },
  {
    title: { ru: 'Выходы', en: 'Exits' },
    text: {
      ru: 'Заражённый завод — «Ворота 0» и «Ворота 3». Заражённая лаборатория — только «Парковка» (нужен ключ от машины) и «Накопительный коллектор» (нужна схема коллектора); оба лежат у круглого стола со статуями котов в зоне отдыха, в офисе O23 и в кабинете Круглова. В лаборатории темно — возьмите фонарь или ПНВ.',
      en: 'Infected Factory: Gate 0 and Gate 3. Infected Lab: only the Parking gate (needs the car keys) and the Sewage conduit (needs the collector map); both lie at the round table with the cat statues in the recreation area, in office O23 and in Kruglov\'s office. The Lab is dark: bring a flashlight or night vision.',
    },
  },
  {
    title: { ru: 'Заражённые', en: 'The infected' },
    text: {
      ru: 'Медленные и быстрые, часть с оружием; надёжнее всего стрелять в голову. Шум приводит их к вам. На заражённых локациях есть Заражённый Тагилла — его нужно убить в «Последнем рывке».',
      en: 'Slow and fast ones, some of them armed; headshots work best. Noise brings them to you. The infected locations have the Infected Tagilla, whom «The Final Push» asks you to kill.',
    },
  },
  {
    title: { ru: 'Газовые гранаты', en: 'Gas grenades' },
    text: {
      ru: 'РДЭ-68 и РДЭ-78 — бартеры у Терапевта. В «Первых результатах» и «Последнем рывке» засчитываются только заражённые, убитые в облаке газа; нужен противогаз или респиратор. РДЭ-78 сам убивает заражённых — стреляйте сразу после броска.',
      en: 'The RDE-68 and RDE-78 are Therapist\'s barters. In «First Results» and «The Final Push» only the infected killed inside the gas count; wear a gas mask or a respirator. The RDE-78 kills the infected by itself: shoot right after the throw.',
    },
  },
  {
    title: { ru: 'Ивентовые предметы', en: 'Event items' },
    text: {
      ru: 'Образец крови — с тел учёных на заражённых локациях. Образцы тканей заражённых — за ежедневные задания Лыжника, прототипы вакцины TG-Vi-24 — за ежедневные задания Терапевта. Всё это продаётся и на барахолке.',
      en: 'The blood sample comes from the scientists\' bodies on the infected locations. Infected tissue samples pay Skier\'s daily tasks, TG-Vi-24 vaccine prototypes pay Therapist\'s. All of them are on the flea market too.',
    },
  },
  {
    title: { ru: 'Выбор стороны', en: 'Picking a side' },
    text: {
      ru: '«Неожиданная помощь» (Лыжник) или «Первичная проверка» (Терапевт), потом «Усиление карантина» или «Новая вакцина»: выполненное задание проваливает задание другой стороны. До конца можно пройти только одну линию.',
      en: '«Unexpected Help» (Skier) or «Initial Examination» (Therapist), then «Tightening the Quarantine» or «A New Vaccine»: the task you complete fails the other side\'s one. Only one line can be finished.',
    },
  },
  {
    title: { ru: 'Достижения', en: 'Achievements' },
    text: {
      ru: '«Торжество науки» — линия Терапевта, «Поднять щиты!» — линия Лыжника, «Groovy» — убить как можно больше заражённых за время ивента.',
      en: '«Triumph of Science» for Therapist\'s line, «Shields Up!» for Skier\'s, «Groovy» for killing as many infected as you can during the event.',
    },
  },
]

const H = HALLOWEEN_QUEST_IDS
/** The event's stages and their tasks in the game's order. */
const STAGES: Array<{ title: Phrase; ids: string[] }> = [
  { title: { ru: 'Начало', en: 'The start' }, ids: [H.rumors, H.bestDefense, H.followUp] },
  { title: { ru: 'Развилка: Лыжник или Терапевт', en: 'The choice: Skier or Therapist' }, ids: [H.unexpectedHelp, H.initialExamination, H.tightening, H.newVaccine] },
  { title: { ru: 'Линия Терапевта', en: 'Therapist\'s line' }, ids: [H.highRisk, H.firstResults, H.studyingEnemy, H.greaterGood, H.greaterGoodAgreement, H.finalPush] },
  { title: { ru: 'Линия Лыжника', en: 'Skier\'s line' }, ids: [H.dangerZone, H.coincidence, H.prototyping, H.enemyOfEnemy, H.enemyAgreement, H.blindEnemy] },
]

const TRADERS: Record<string, Phrase> = {
  '58330581ace78e27b8b10cee': { ru: 'Лыжник', en: 'Skier' },
  '54cb57776803fa99248b456e': { ru: 'Терапевт', en: 'Therapist' },
}
const CURRENCY: Record<string, (count: number, lang: Lang) => string> = {
  '5449016a4bdc2d6f028b456f': (count) => `${count.toLocaleString('ru-RU')} ₽`,
  '569668774bdc2da2298b4568': (count, lang) => lang === 'en' ? `€${count.toLocaleString('en-US')}` : `${count.toLocaleString('ru-RU')} €`,
}

interface ShownQuest {
  id: string
  /** Its place in the event, 1-based. */
  number: number
  name: string
  trader: string
  objectives: Array<{ id: string; description: string }>
  rewards: string[]
  note: string
  /** The maps its points are on (ours: the infected locations' points are on the ordinary Factory and Lab). */
  maps: string[]
  /** The catalog of this mode has it: «Открыть квест» leads somewhere. */
  inCatalog: boolean
}

/**
 * A task in the app's language from the event's own data; the catalog names the reward items (in its language) and says
 * whether this mode has the task.
 */
function shownQuest(own: CuratedQuest, number: number, catalog: Pick<AppDataset, 'quests' | 'items'> | undefined, lang: Lang): ShownQuest {
  const items = new Map((catalog?.items ?? []).map((item) => [item.id, item.name]))
  const rewards = [
    `${own.experience.toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')} ${lang === 'en' ? 'XP' : 'опыта'}`,
    ...(own.rewards ?? []).map(([id, count]) => CURRENCY[id]?.(count, lang) ?? (items.has(id) ? `${items.get(id)} × ${count}` : '')),
    ...(own.rewardNotes ?? []).map((line) => line[lang]),
  ].filter(Boolean)
  return {
    id: own.id,
    number,
    name: own.name[lang].replace(/^Halloween:\s*/, ''),
    trader: TRADERS[own.trader]?.[lang] ?? '',
    objectives: own.objectives.map((objective, index) => ({ id: `${own.id}-objective-${index + 1}`, description: objective.text[lang] })),
    rewards,
    note: own.note[lang],
    maps: [...new Set(own.objectives.flatMap((objective) => (objective.spots ?? []).map((spot) => canonicalMapId(spot.map))))],
    inCatalog: Boolean(catalog?.quests.some((quest: Quest) => quest.id === own.id)),
  }
}

/** Every stage with its tasks, numbered through the whole event. */
function shownStages(catalog: Pick<AppDataset, 'quests' | 'items'> | undefined, lang: Lang) {
  const byId = new Map(HALLOWEEN_2026.quests.map((quest) => [quest.id, quest]))
  let number = 0
  return STAGES.map((stage) => ({
    title: stage.title,
    quests: stage.ids.flatMap((id) => {
      const own = byId.get(id)
      if (!own) return []
      number += 1
      return [shownQuest(own, number, catalog, lang)]
    }),
  }))
}

/**
 * The window the button opens: the event's facts, then every task by stage with its objectives, rewards, places and photos.
 * Mounted beside the notices rather than after them (src/app/App.tsx): it opens only on a click, so it never waits.
 */
export function HalloweenEventWindow() {
  const [open, setOpen] = useState(false)
  const active = useHalloweenActive()
  useEffect(() => {
    const show = () => { if (halloweenEventActive()) setOpen(true) }
    window.addEventListener(HALLOWEEN_OPEN_EVENT, show)
    return () => window.removeEventListener(HALLOWEEN_OPEN_EVENT, show)
  }, [])
  if (!open || !active) return null
  return <HalloweenStory onClose={() => setOpen(false)} />
}

function HalloweenStory({ onClose }: { onClose: () => void }) {
  const { locale } = useLocale()
  const lang: Lang = locale === 'en' ? 'en' : 'ru'
  const say = (phrase: Phrase) => phrase[lang]
  const catalog = useOptionalTarkovData()?.data
  const close = useRef<HTMLButtonElement>(null)
  const done = useRef(onClose)
  useEffect(() => { done.current = onClose })
  useEffect(() => {
    close.current?.focus({ preventScroll: true })
    // first, before the page under it (the map takes Escape for itself)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); done.current() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const stages = shownStages(catalog, lang)
  return createPortal(
    <div className="halloween-layer" role="dialog" aria-modal="true" aria-labelledby="halloween-title" onClick={(event) => { if (event.target === event.currentTarget) done.current() }}>
      <section className="panel halloween-card">
        <div className="halloween-head">
          <span className="halloween-icon"><Biohazard size={20} aria-hidden="true" /></span>
          <div className="eyebrow">{say(TEXT.eyebrow)}</div>
        </div>
        <h2 id="halloween-title">{say(TEXT.title)}</h2>
        <p className="halloween-story">{say(TEXT.story)}</p>
        <h3>{say(TEXT.info)}</h3>
        <div className="halloween-facts">
          {FACTS.map((fact) => <div key={fact.title.ru} className="halloween-fact"><strong>{say(fact.title)}</strong><p>{say(fact.text)}</p></div>)}
        </div>
        <h3>{say(TEXT.quests)}</h3>
        {stages.map((stage) => <div key={stage.title.ru} className="halloween-stage">
          <h4>{say(stage.title)}</h4>
          <div className="halloween-quests">
            {stage.quests.map((quest) => <details key={quest.id} className="halloween-quest">
              <summary>
                <span className="halloween-quest-number">{quest.number}</span>
                <strong>{quest.name}</strong>
                <small>{quest.trader}</small>
                <ChevronRight size={14} className="halloween-quest-chevron" aria-hidden="true" />
              </summary>
              <div className="halloween-quest-body">
                <h5>{say(TEXT.objectives)}</h5>
                <ul>{quest.objectives.map((objective) => <li key={objective.id}>{objective.description}</li>)}</ul>
                <h5>{say(TEXT.rewards)}</h5>
                <ul>{quest.rewards.map((line, at) => <li key={`${at}-${line}`}>{line}</li>)}</ul>
                <p>{quest.note}</p>
                <QuestGuidePhotos quest={{ id: quest.id, objectiveDetails: quest.objectives }} />
                <div className="halloween-quest-actions">
                  {quest.maps.length > 0 && <span className="halloween-quest-maps"><MapPin size={13} aria-hidden="true" />{say(TEXT.onMap)}:</span>}
                  {quest.maps.map((mapId) => <Link key={mapId} className="button small ghost" to={`/maps/${mapId}?quest=${encodeURIComponent(quest.id)}`} onClick={() => done.current()}>
                    {mapDisplayName(mapId, catalog?.maps)}
                  </Link>)}
                  {quest.inCatalog && <Link className="button small ghost" to={`/quests?filter=all&selected=${encodeURIComponent(quest.id)}`} onClick={() => done.current()}>{say(TEXT.openQuest)} <ChevronRight size={13} aria-hidden="true" /></Link>}
                </div>
              </div>
            </details>)}
          </div>
        </div>)}
        <button ref={close} type="button" className="button primary halloween-close" onClick={() => done.current()}>{say(TEXT.close)}</button>
      </section>
    </div>,
    document.body,
  )
}
