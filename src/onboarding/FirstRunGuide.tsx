import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { ArrowUp, Check, Lightbulb, MapPin, MousePointer2 } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import { useMobileLayout } from '../platform'
import { useServerStatus } from '../sync/serverSync'
import kappaContainer from '../assets/guide/kappa-container.webp'
import { acceptStep, GUIDE_CHANGED_EVENT, GUIDE_TIMING, guideForAccount, guideStepFor, type GuideRecord, type GuideStep } from './firstRunGuide'
import './firstRunGuide.css'

type Phrase = { ru: string; en: string }

/** Room between the part and the tip for the bouncing pointer. */
const POINTER_GAP = 46
const EDGE = 12

const now = () => Date.now()
const appStarted = now()

interface Tip {
  title: Phrase
  text: (phone: boolean) => Phrase
  /** The part of the page the tip points at, when it is there. */
  target?: string
  media?: 'checkmark' | 'kappa'
  /** Show a press on the part itself (the map checkmark). */
  press?: boolean
}

const TIPS: Record<GuideStep, Tip> = {
  // owner: «при нажатии на текущие задания, должен появится указатель на сюжетные квесты и всплывающее окно, о том что
  // нужно в игре открыть окно каждого сюжетного квеста для синхронизации… достаточно открыть окно на 3 секунды»
  quests: {
    title: { ru: 'Сюжетные задания', en: 'Story quests' },
    text: () => ({
      ru: 'Чтобы приложение знало, где вы в сюжете, откройте в игре окно каждого сюжетного задания («Персонаж» → «Задания»). Достаточно держать окно открытым 3 секунды — приложение само прочитает задание и его этапы, и они появятся на вкладке «Сюжетные».',
      en: 'To let the app know where you are in the story, open each story quest’s window in the game (Character → Tasks). Keeping it open for 3 seconds is enough: the app reads the quest and its stages by itself, and they appear on the “Story” tab.',
    }),
    target: '[data-guide="story-tab"]',
  },
  // owner: «при нажатии на блок мини карта, всплывающее окно: то что у нас написано сверху»
  minimap: {
    title: { ru: 'Мини-карта и карточка предмета', en: 'Mini map and item card' },
    text: () => ({
      ru: 'Мини-карта и карточка предмета показываются поверх игры. Для этого в настройках графики поставьте режим экрана «Безрамочный».',
      en: 'The mini map and the item card are shown over the game. For this, set the screen mode to “Borderless” in the graphics settings.',
    }),
  },
  // owner: «указатель на галочку с квестом. показать анимацию нажатия. и обяснить для чего эта кнопка»
  maps: {
    title: { ru: 'Галочка у задания', en: 'The checkmark by a quest' },
    text: (phone) => ({
      ru: `Сделали задание в этом рейде — нажмите галочку справа от него. Его точки уйдут с карты, а само задание — в конец списка, чтобы не мешать. Это только ваша заметка: в игре задание от неё не выполняется. ${phone ? 'Галочки остаются, пока вы их не снимете.' : 'Галочки снимаются сами, когда вы заходите в следующий рейд.'}`,
      en: `Done a quest in this raid? Press the checkmark to its right. Its points leave the map and the quest moves to the end of the list, out of the way. It is only your note: it does not complete the quest in the game. ${phone ? 'The checkmarks stay until you clear them.' : 'The checkmarks clear by themselves when you enter your next raid.'}`,
    }),
    target: '.quest-raid-check',
    media: 'checkmark',
    press: true,
  },
  // owner: «скриншот с размещенными в одном контейнере предметов. обясни что нужно расположить в одном месте все найденые
  // предметы и нажать кнопку синхронизации, либо можно отметить вручную»
  kappa: {
    title: { ru: 'Предметы для «Коллекционера»', en: 'Items for “Collector”' },
    text: (phone) => (phone ? {
      ru: 'Отмечайте собранные предметы — нажмите на предмет в списке. В приложении для ПК их можно найти сканированием: сложите всё в один контейнер, как на картинке, и нажмите «Сканировать». Список общий через аккаунт.',
      en: 'Tick the items you have collected: press an item in the list. In the PC app a scan finds them: put everything into one container, like in the picture, and press “Scan”. The list is shared through your account.',
    } : {
      ru: 'Сложите все найденные предметы в один контейнер, как на картинке, откройте его в игре и нажмите «Сканировать» — приложение само отметит, что нашло. Или отметьте предметы вручную: нажмите на предмет в списке.',
      en: 'Put all the items you found into one container, like in the picture, open it in the game and press “Scan”: the app ticks what it finds. Or tick items by hand: press an item in the list.',
    }),
    media: 'kappa',
  },
}

const TIP_LABEL: Phrase = { ru: 'Подсказка', en: 'Tip' }
const ACCEPT: Phrase = { ru: 'Принял', en: 'Got it' }
const KAPPA_ALT: Phrase = { ru: 'Предметы для «Коллекционера», сложенные в один контейнер в игре', en: 'Collector items put together in one container in the game' }
const DEMO_QUEST: Phrase = { ru: 'Поставка из прошлого', en: 'Delivery From the Past' }
const DEMO_MAP: Phrase = { ru: 'Таможня', en: 'Customs' }

/**
 * The first-run guide (src/onboarding/firstRunGuide.ts): on the first visit of a section, a new account's player gets the
 * section's tip with «Принял». Mounted once, outside the pages; it waits for the startup notices and for the page.
 */
export function FirstRunGuide() {
  const { pathname } = useLocation()
  const status = useServerStatus()
  const phone = useMobileLayout()
  const [guide, setGuide] = useState<{ email: string; record: GuideRecord } | null>(null)
  useEffect(() => {
    const read = () => setGuide(guideForAccount(status))
    read()
    window.addEventListener(GUIDE_CHANGED_EVENT, read)
    return () => window.removeEventListener(GUIDE_CHANGED_EVENT, read)
  }, [status])
  const step = guide ? guideStepFor(pathname, phone) : null
  const pending = step && guide && !guide.record.accepted.includes(step) ? step : null
  const ready = useReady(pending, pathname)
  if (!guide || !pending || !ready) return null
  return <GuideTip key={pending} step={pending} phone={phone} onAccept={() => acceptStep(guide.email, pending)} />
}

/** True once the app has started, the page has settled and no other dialog (update, subscription) is open. */
function useReady(step: GuideStep | null, pathname: string) {
  const [ready, setReady] = useState<string | null>(null)
  const key = step ? `${step}:${pathname}` : null
  useEffect(() => {
    if (!key) return
    const entered = now()
    const check = () => {
      const settled = now() - entered >= GUIDE_TIMING.settleMs && now() - appStarted >= GUIDE_TIMING.startupGraceMs
      if (settled && !document.querySelector('[aria-modal="true"]')) { setReady(key); return true }
      return false
    }
    if (check()) return
    const timer = window.setInterval(() => { if (check()) window.clearInterval(timer) }, 300)
    return () => window.clearInterval(timer)
  }, [key])
  return key !== null && ready === key
}

interface Box { left: number; top: number; width: number; height: number }

/** The part a tip points at, once the page has drawn it (looked for a few seconds), and where it is on the screen. */
function useTarget(selector?: string) {
  const [box, setBox] = useState<Box | null>(null)
  useEffect(() => {
    if (!selector) return
    let element: HTMLElement | null = null
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!element?.isConnected) { setBox(null); return }
        const rect = element.getBoundingClientRect()
        setBox(rect.width && rect.height ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null)
      })
    }
    const started = now()
    const find = () => {
      element = [...document.querySelectorAll<HTMLElement>(selector)].find((candidate) => candidate.getClientRects().length > 0) ?? null
      if (element) {
        const rect = element.getBoundingClientRect()
        if (rect.top < 0 || rect.bottom > window.innerHeight) element.scrollIntoView({ block: 'center' })
        measure()
        return true
      }
      return now() - started > GUIDE_TIMING.targetWaitMs
    }
    const timer = find() ? 0 : window.setInterval(() => { if (find()) window.clearInterval(timer) }, 250)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearInterval(timer)
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [selector])
  return box
}

interface Placement { left: number; top: number; pointer?: { left: number; top: number; up: boolean } }

function GuideTip({ step, phone, onAccept }: { step: GuideStep; phone: boolean; onAccept: () => void }) {
  const { locale } = useLocale()
  const say = (phrase: Phrase) => phrase[locale === 'en' ? 'en' : 'ru']
  const tip = TIPS[step]
  const target = useTarget(tip.target)
  const card = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const [place, setPlace] = useState<Placement | null>(null)

  // Next to the part it points at (below, else above), the pointer between them; centred without one.
  useLayoutEffect(() => {
    const node = card.current
    if (!node) return
    const width = node.offsetWidth
    const height = node.offsetHeight
    if (!target) {
      setPlace({ left: Math.max(EDGE, (window.innerWidth - width) / 2), top: Math.max(EDGE, (window.innerHeight - height) / 2) })
      return
    }
    const centre = target.left + target.width / 2
    const left = Math.min(Math.max(EDGE, centre - width / 2), window.innerWidth - width - EDGE)
    const below = target.top + target.height + POINTER_GAP
    const fitsBelow = below + height + EDGE <= window.innerHeight
    const top = fitsBelow ? below : Math.max(EDGE, target.top - POINTER_GAP - height)
    const pointerTop = fitsBelow ? target.top + target.height + 8 : target.top - POINTER_GAP + 8
    setPlace({ left, top, pointer: { left: centre, top: pointerTop, up: fitsBelow } })
  }, [target])

  // The button takes the focus; Escape is «Принял» too; the focus goes back where it was.
  const accept = useRef(onAccept)
  useLayoutEffect(() => { accept.current = onAccept })
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    button.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); accept.current() }
      // The tip is the only thing to answer: Tab stays on its button.
      if (event.key === 'Tab') { event.preventDefault(); button.current?.focus({ preventScroll: true }) }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div className={`frg-layer${phone ? ' is-phone' : ''}`} data-step={step}>
      {target
        ? <div className="frg-spot" style={{ left: target.left - 6, top: target.top - 6, width: target.width + 12, height: target.height + 12 }}>
          {tip.press && <span className="frg-tap" aria-hidden="true" />}
        </div>
        : <div className="frg-dim" />}
      {place?.pointer && <span className={`frg-pointer${place.pointer.up ? '' : ' is-down'}`} style={{ left: place.pointer.left, top: place.pointer.top }} aria-hidden="true">
        <ArrowUp size={26} strokeWidth={2.6} />
      </span>}
      <div ref={card} className={`frg-card${place ? ' is-placed' : ''}`} style={place ? { left: place.left, top: place.top } : undefined}
        role="dialog" aria-modal="true" aria-labelledby="frg-title" aria-describedby="frg-text">
        <div className="frg-eyebrow"><Lightbulb size={13} aria-hidden="true" /> {say(TIP_LABEL)}</div>
        <h2 id="frg-title">{say(tip.title)}</h2>
        {tip.media === 'checkmark' && <CheckmarkDemo quest={say(DEMO_QUEST)} map={say(DEMO_MAP)} />}
        {tip.media === 'kappa' && <img className="frg-shot" src={kappaContainer} alt={say(KAPPA_ALT)} width={681} height={712} />}
        <p id="frg-text">{say(tip.text(phone))}</p>
        <button ref={button} type="button" className="button primary frg-accept" onClick={onAccept}>{say(ACCEPT)}</button>
      </div>
    </div>,
    document.body,
  )
}

/**
 * How the checkmark works, in a loop: the cursor presses the checkmark of a quest row, the row steps back and its points
 * leave the map. With reduced motion: the checked state, still.
 */
function CheckmarkDemo({ quest, map }: { quest: string; map: string }) {
  return <div className="frg-demo" aria-hidden="true">
    <div className="frg-demo-map">
      <span className="frg-demo-pin"><MapPin size={16} /></span>
      <span className="frg-demo-pin is-second"><MapPin size={16} /></span>
    </div>
    <div className="frg-demo-row">
      <span className="frg-demo-copy"><strong>{quest}</strong><small>{map}</small></span>
      <span className="frg-demo-check"><Check size={15} strokeWidth={3} /></span>
    </div>
    <span className="frg-demo-cursor"><MousePointer2 size={20} /></span>
  </div>
}
