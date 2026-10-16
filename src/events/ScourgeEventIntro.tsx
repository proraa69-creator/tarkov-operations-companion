import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Skull, SkipForward, Swords, Volume2 } from 'lucide-react'
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
  next: { ru: 'Далее', en: 'Next' },
  // owner, 16.10.2026, word for word
  story: {
    ru: 'В игру добавили новую цепочку заданий, связанную с операцией Рефа в Лаборатории. На Лаборатории со 100% шансом появляется новый босс — гладиатор Scourge со свитой из четырёх человек. Всего у него два спавна:',
    en: 'A new quest chain about Ref’s operation in the Lab has been added to the game. A new boss spawns in the Lab with a 100% chance: the gladiator Scourge with a retinue of four. He has two spawns in total:',
  },
  spawns: [
    { ru: 'На котах', en: 'At the cats' },
    { ru: 'Под офисом управляющего', en: 'Under the manager’s office' },
  ],
  quests: { ru: 'Задания ивента (все режимы)', en: 'Event quests (every mode)' },
  questList: [
    { ru: 'Скрытый маршрут — найти на Заводе переход в Лабораторию', en: 'Hidden Route: find the transit to the Lab on Factory' },
    { ru: 'Простая задача в непростом месте — выжить и выйти из Лаборатории', en: 'A Simple Task in a Difficult Place: survive and extract from the Lab' },
    { ru: 'Нарушить координацию — устранить 6 любых целей в Лаборатории', en: 'Disrupt the Coordination: eliminate any 6 targets in the Lab' },
  ],
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
  const [active, setActive] = useState(() => scourgeEventActive())

  // The event ends while the app is open: everything goes away by itself.
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => { setActive(false); setStep(null) }, Math.min(SCOURGE_EVENT_END - Date.now(), 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [active])

  useEffect(() => {
    const open = () => { if (scourgeEventActive()) setStep('video') }
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
      setStep('video')
    }
    const timer = window.setInterval(check, 500)
    check()
    return () => window.clearInterval(timer)
  }, [due, ready])

  if (!active || step === null) return null
  if (step === 'video') return <EventVideo say={say} onDone={() => setStep('story')} />
  if (step === 'story') return <EventStory say={say} onNext={() => setStep('boss')} />
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
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone })
  useEffect(() => {
    skip.current?.focus({ preventScroll: true })
    const node = video.current
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

/** What the event is: the owner's text, the two spawns, the event quests and the end date. */
function EventStory({ say, onNext }: { say: (phrase: Phrase) => string; onNext: () => void }) {
  const next = useRef<HTMLButtonElement>(null)
  const go = useRef(onNext)
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
        </div>
        <h2 id="scourge-story-title">{say(TEXT.title)}</h2>
        <p>{say(TEXT.story)}</p>
        <ul className="scourge-story-list">{TEXT.spawns.map((spawn) => <li key={spawn.ru}>{say(spawn)}</li>)}</ul>
        <h3>{say(TEXT.quests)}</h3>
        <ul className="scourge-story-list">{TEXT.questList.map((quest) => <li key={quest.ru}>{say(quest)}</li>)}</ul>
        <p className="scourge-story-until">{say(TEXT.until)}</p>
        <button ref={next} type="button" className="button primary scourge-story-next" onClick={() => go.current()}>{say(TEXT.next)}</button>
      </section>
    </div>,
    document.body,
  )
}
