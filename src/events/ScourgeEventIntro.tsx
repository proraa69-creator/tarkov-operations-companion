import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, Film, Skull, SkipForward, Swords, Volume2, VolumeX } from 'lucide-react'
import { useOptionalTarkovData } from '../data/DataProvider'
import { SCOURGE_INVASION, SCOURGE_QUEST_IDS, type CuratedQuest } from '../data/curatedQuests'
import { QuestGuideImages } from '../components/QuestCuratedInfo'
import type { Quest } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'
import { useMobileLayout } from '../platform'
import { GuideTip, useGuideReady, type GuideTipContent } from '../onboarding/FirstRunGuide'
import { SCOURGE_BOSS_KEY, SCOURGE_EVENT_END, SCOURGE_EVENT_VIDEO, SCOURGE_INTRO_KEY, SCOURGE_OPEN_EVENT, scourgeEventActive } from './scourgeEvent'
import './scourgeEvent.css'

type Phrase = { ru: string; en: string }

const TEXT = {
  eyebrow: { ru: 'Новый ивент', en: 'New event' },
  title: { ru: 'Вторжение Scourge', en: 'Scourge Invasion' },
  skip: { ru: 'Пропустить', en: 'Skip' },
  sound: { ru: 'Включить звук', en: 'Sound on' },
  volume: { ru: 'Громкость', en: 'Volume' },
  next: { ru: 'Далее', en: 'Next' },
  close: { ru: 'Закрыть', en: 'Close' },
  replay: { ru: 'Смотреть ролик', en: 'Watch the clip' },
  objectives: { ru: 'Цели', en: 'Objectives' },
  startGear: { ru: 'При взятии', en: 'On taking' },
  rewards: { ru: 'Награды', en: 'Rewards' },
  side: { ru: 'побочное', en: 'side task' },
  openQuest: { ru: 'Открыть квест', en: 'Open the quest' },
  // owner, 16.10.2026, word for word
  story: {
    ru: 'В игру добавили новую цепочку заданий, связанную с операцией Рефа в Лаборатории. На Лаборатории со 100% шансом появляется новый босс — гладиатор Scourge со свитой из четырёх человек. Всего у него два спавна:',
    en: 'A new quest chain about Ref’s operation in the Lab has been added to the game. A new boss spawns in the Lab with a 100% chance: the gladiator Scourge with a retinue of four. He has two spawns in total:',
  },
  spawns: [
    { ru: 'На котах', en: 'At the cats' },
    { ru: 'Под офисом управляющего', en: 'Under the manager’s office' },
  ],
  quests: { ru: 'Задания ивента: пять основных и одно побочное (все режимы)', en: 'Event quests: five main and one side task (every mode)' },
  until: { ru: 'Scourge появляется во всех режимах: PvP, PvE и «Сезон». Ивент идёт до 20 октября, 10:00 по Москве.', en: 'Scourge spawns in every mode: PvP, PvE and Season. The event runs until 20 October, 08:00 BST.' },
  openBoss: { ru: 'Открыть «Боссы»', en: 'Open Bosses' },
}

const BOSS_TIP: GuideTipContent = {
  title: { ru: 'Добавлен новый босс', en: 'A new boss has been added' },
  text: () => ({
    ru: 'Гладиатор Scourge — во вкладке «Боссы»: 3D-модель, его вооружение и лут, а также оружие и снаряжение охраны.',
    en: 'The gladiator Scourge is in the Bosses tab: the 3D model, his weapons and loot, and his guards’ weapons and gear.',
  }),
  target: '.nav-link[href$="/gallery"]',
}

// Storage unavailable: taken as watched, so the intro does not come back on every start.
const readSeen = () => { try { return localStorage.getItem(SCOURGE_INTRO_KEY) !== null } catch { return true } }
const markSeen = () => { try { localStorage.setItem(SCOURGE_INTRO_KEY, new Date().toISOString()) } catch { /* shows again next start */ } }

type Step = 'video' | 'story' | 'boss'

/**
 * «Новый ивент Вторжение Scourge» (owner, 16.10.2026: «после обновления при запуске… покажи ролик во всплывающем окне,
 * добавь кнопку пропустить. при нажатии на нее, появляется сразу же всплывающее окно с описанием квеста… после просмотра
 * этого всплывающего окна, добавь… Добавлен новый босс и указатель на вкладку боссы»). Once per device at the first start
 * during the event, after the other startup tips; the Overview's event button opens it again. Nothing after the event.
 */
export function ScourgeEventIntro() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const phone = useMobileLayout()
  const { locale } = useLocale()
  const say = (phrase: Phrase) => phrase[locale === 'en' ? 'en' : 'ru']
  const [seen, setSeen] = useState(readSeen)
  const [step, setStep] = useState<Step | null>(null)
  const [fromButton, setFromButton] = useState(false)
  const [active, setActive] = useState(() => scourgeEventActive())

  // The event ends while the app is open: everything goes away by itself.
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => { setActive(false); setStep(null) }, Math.min(SCOURGE_EVENT_END - Date.now(), 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [active])

  useEffect(() => {
    // the Overview's event button: the quests at once, the clip one click away
    const open = () => { if (scourgeEventActive()) { setFromButton(true); setStep('story') } }
    window.addEventListener(SCOURGE_OPEN_EVENT, open)
    return () => window.removeEventListener(SCOURGE_OPEN_EVENT, open)
  }, [])

  // At startup: once the app has settled and no other tip or dialog is open.
  const due = active && !seen && step === null
  const ready = useGuideReady(due ? 'scourge-event' : null, pathname)
  useEffect(() => {
    if (!due || !ready) return
    const check = () => {
      if (document.querySelector('.frg-layer')) return
      markSeen()
      setSeen(true)
      setFromButton(false)
      setStep('video')
    }
    const timer = window.setInterval(check, 500)
    check()
    return () => window.clearInterval(timer)
  }, [due, ready])

  if (!active || step === null) return null
  if (step === 'video') return <EventVideo say={say} onDone={() => setStep('story')} />
  if (step === 'story') {
    return <EventStory say={say} locale={locale === 'en' ? 'en' : 'ru'} finalLabel={fromButton ? TEXT.close : TEXT.next}
      onNext={() => setStep(fromButton ? null : 'boss')} onReplay={() => setStep('video')} onOpenQuest={() => setStep(null)} />
  }
  return <GuideTip id="scourge-boss" tip={BOSS_TIP} phone={phone} onAccept={() => setStep(null)}>
    <button type="button" className="button ghost scourge-open-boss" onClick={() => { setStep(null); navigate('/gallery', { state: { boss: SCOURGE_BOSS_KEY } }) }}>
      <Skull size={15} aria-hidden="true" />{say(TEXT.openBoss)}
    </button>
  </GuideTip>
}

/** The event clip over the app with «Пропустить»; the end of the clip, Escape or a failed load go on to the story. */
function EventVideo({ say, onDone }: { say: (phrase: Phrase) => string; onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const skip = useRef<HTMLButtonElement>(null)
  const [muted, setMuted] = useState(false)
  // owner, 16.10.2026: «сделай регулировку звука… и звук в два раза тише при запуске»
  const [volume, setVolume] = useState(0.5)
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone })
  useEffect(() => {
    skip.current?.focus({ preventScroll: true })
    const node = video.current
    if (node) node.volume = 0.5
    // With sound when the app may; a browser that refuses plays it muted with a «sound on» button.
    const quiet = () => { if (!node) return; node.muted = true; setMuted(true); try { node.play()?.catch(() => undefined) } catch { /* no playback here */ } }
    try { node?.play()?.catch(quiet) } catch { quiet() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); done.current() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return createPortal(
    <div className="scourge-layer" role="dialog" aria-modal="true" aria-labelledby="scourge-video-title">
      <div className="scourge-video-card">
        <div className="scourge-video-head">
          <div><div className="eyebrow">{say(TEXT.eyebrow)}</div><h2 id="scourge-video-title">{say(TEXT.title)}</h2></div>
          <div className="scourge-video-actions">
            {muted && <button type="button" className="button small ghost" onClick={() => { const node = video.current; if (node) { node.muted = false; setMuted(false) } }}><Volume2 size={14} aria-hidden="true" />{say(TEXT.sound)}</button>}
            <label className="scourge-volume" title={say(TEXT.volume)}>
              {volume === 0 ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
              <input type="range" min={0} max={100} step={1} value={Math.round(volume * 100)} aria-label={say(TEXT.volume)}
                onChange={(event) => {
                  const next = Number(event.target.value) / 100
                  setVolume(next)
                  const node = video.current
                  if (node) { node.volume = next; if (next > 0 && node.muted) { node.muted = false; setMuted(false) } }
                }} />
            </label>
            <button ref={skip} type="button" className="button small primary" onClick={() => done.current()}><SkipForward size={14} aria-hidden="true" />{say(TEXT.skip)}</button>
          </div>
        </div>
        <video ref={video} className="scourge-video" src={SCOURGE_EVENT_VIDEO} playsInline preload="auto"
          onEnded={() => done.current()} onError={() => done.current()} />
      </div>
    </div>,
    document.body,
  )
}

/** The chain in the game's order and the side task, from the catalog when it has them (the owner's edits applied). */
const ORDER: readonly string[] = [
  SCOURGE_QUEST_IDS.hiddenRoute, SCOURGE_QUEST_IDS.simpleTask, SCOURGE_QUEST_IDS.coordination,
  SCOURGE_QUEST_IDS.informationTrail, SCOURGE_QUEST_IDS.soulJob, SCOURGE_QUEST_IDS.deanon,
]

interface ShownQuest { id: string; name: string; trader?: string; objectives: string[]; rewards: string[]; note: string; side: boolean; guideImages?: Quest['guideImages']; quest?: Quest }

const ROUBLES = '5449016a4bdc2d6f028b456f'

/** Without the quest in the catalog (not loaded yet): the experience, the items the catalog can name and the skills. */
function ownRewards(own: CuratedQuest, items: ReadonlyMap<string, string>, locale: 'ru' | 'en'): string[] {
  const named = (id: string, count: number) => id === ROUBLES
    ? `${count.toLocaleString('ru-RU')} ₽`
    : items.has(id) ? `${items.get(id)} × ${count}` : ''
  return [
    own.experience ? `${own.experience.toLocaleString('ru-RU')} ${locale === 'en' ? 'XP' : 'опыта'}` : '',
    ...(own.rewards ?? []).map(([id, count]) => named(id, count)),
    ...(own.skills ?? []).map((skill) => skill[locale]),
    ...(own.startRewards ?? []).map(([id, count]) => (items.has(id) ? `${locale === 'en' ? 'On taking the task' : 'При взятии задания'}: ${named(id, count)}` : '')),
  ].filter(Boolean)
}

function eventQuests(catalog: { quests: readonly Quest[]; items: ReadonlyArray<{ id: string; name: string }> } | undefined, locale: 'ru' | 'en'): ShownQuest[] {
  const byId = new Map((catalog?.quests ?? []).map((quest) => [quest.id, quest]))
  const items = new Map((catalog?.items ?? []).map((item) => [item.id, item.name]))
  return ORDER.flatMap((id): ShownQuest[] => {
    const quest = byId.get(id)
    const own = SCOURGE_INVASION.quests.find((entry) => entry.id === id)
    const side = id === SCOURGE_QUEST_IDS.deanon
    if (quest) {
      // the catalog's description starts with the series line; the quest's own words follow it
      const note = quest.description.replace(/^[^.]*?задание \d+ из \d+\.\s*|^[^.]*?task \d+ of \d+\.\s*/u, '')
      return [{ id, name: quest.name, trader: quest.trader, objectives: quest.objectives, rewards: quest.rewards, note, side, guideImages: quest.guideImages, quest }]
    }
    if (!own) return []
    return [{ id, name: own.name[locale], objectives: own.objectives.map((objective) => objective.text[locale]), rewards: ownRewards(own, items, locale), note: own.note[locale], side,
      guideImages: own.guideImages?.map((image) => ({ file: image.file, caption: image.caption[locale] })) }]
  })
}

/** What the event is: the owner's text, the two spawns, every event quest with its objectives and rewards, the end date. */
function EventStory({ say, locale, finalLabel, onNext, onReplay, onOpenQuest }: {
  say: (phrase: Phrase) => string
  locale: 'ru' | 'en'
  finalLabel: Phrase
  onNext: () => void
  onReplay: () => void
  onOpenQuest: () => void
}) {
  const next = useRef<HTMLButtonElement>(null)
  const go = useRef(onNext)
  const catalog = useOptionalTarkovData()?.data
  const quests = eventQuests(catalog, locale)
  useEffect(() => { go.current = onNext })
  useEffect(() => {
    next.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); go.current() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return createPortal(
    <div className="scourge-layer" role="dialog" aria-modal="true" aria-labelledby="scourge-story-title">
      <section className="panel scourge-story-card">
        <div className="scourge-story-head">
          <span className="scourge-story-icon"><Swords size={20} aria-hidden="true" /></span>
          <div className="eyebrow">{say(TEXT.eyebrow)}</div>
          <button type="button" className="button small ghost scourge-replay" onClick={onReplay}><Film size={14} aria-hidden="true" />{say(TEXT.replay)}</button>
        </div>
        <h2 id="scourge-story-title">{say(TEXT.title)}</h2>
        <p>{say(TEXT.story)}</p>
        <ul className="scourge-story-list">{TEXT.spawns.map((spawn) => <li key={spawn.ru}>{say(spawn)}</li>)}</ul>
        <h3>{say(TEXT.quests)}</h3>
        <div className="scourge-quests">
          {quests.map((quest, index) => (
            <details key={quest.id} className="scourge-quest">
              <summary>
                <span className="scourge-quest-number">{quest.side ? '+' : index + 1}</span>
                <strong>{quest.name}</strong>
                <small>{[quest.trader, quest.side ? say(TEXT.side) : ''].filter(Boolean).join(' · ')}</small>
                <ChevronRight size={14} className="scourge-quest-chevron" aria-hidden="true" />
              </summary>
              <div className="scourge-quest-body">
                <h4>{say(TEXT.objectives)}</h4>
                <ul>{quest.objectives.map((line, at) => <li key={`${at}-${line}`}>{line}</li>)}</ul>
                {quest.rewards.length > 0 && <><h4>{say(TEXT.rewards)}</h4><ul>{quest.rewards.map((line, at) => <li key={`${at}-${line}`}>{line}</li>)}</ul></>}
                {quest.note && <p>{quest.note}</p>}
                {quest.guideImages?.length ? <QuestGuideImages quest={quest} /> : null}
                {quest.quest && <Link className="button small ghost" to={`/quests?filter=all&selected=${encodeURIComponent(quest.id)}`} onClick={onOpenQuest}>{say(TEXT.openQuest)} <ChevronRight size={13} aria-hidden="true" /></Link>}
              </div>
            </details>
          ))}
        </div>
        <p className="scourge-story-until">{say(TEXT.until)}</p>
        <button ref={next} type="button" className="button primary scourge-story-next" onClick={() => go.current()}>{say(finalLabel)}</button>
      </section>
    </div>,
    document.body,
  )
}
