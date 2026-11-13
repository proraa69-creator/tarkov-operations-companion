import { useEffect, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, MapPin, TriangleAlert } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import controlsTab from '../assets/guide/game-settings-controls.webp'
import screenshotRow from '../assets/guide/game-settings-screenshot-key.webp'
import './firstRunGuide.css'

type Phrase = { ru: string; en: string }
/** A part of a game screenshot the window points at, in % of the picture: left, top, width, height; the arrow above it (`down`, the default), beside it (`left`) or none. */
type Mark = [number, number, number, number, ('down' | 'left' | false)?]

const TITLE: Phrase = { ru: 'Настройте клавишу скриншота', en: 'Set up the screenshot key' }
const EYEBROW: Phrase = { ru: 'Местоположение на карте', en: 'Your location on the map' }
const WHY: Phrase = {
  ru: 'Raid OS ставит вашу точку на карту по скриншоту из игры: игра записывает в него координаты. Клавишу нужно назначить один раз.',
  en: 'Raid OS puts your point on the map from a game screenshot: the game writes your coordinates into it. You set the key once.',
}
const STEP_TAB: Phrase = { ru: 'В игре откройте «Настройки» → «Управление».', en: 'In the game, open Settings → Controls.' }
const STEP_ROW: Phrase = {
  ru: 'Найдите строку «Сделать скриншот» и назначьте на неё любую удобную для вас клавишу.',
  en: 'Find the screenshot line and set any key that suits you.',
}
const STEP_RAID: Phrase = { ru: 'В рейде нажмите эту клавишу — ваша точка появится на карте Raid OS.', en: 'Press this key in a raid: your point shows up on the Raid OS map.' }
const MAIN: Phrase = { ru: 'Главное:', en: 'Important:' }
const WARN: Phrase = {
  ru: 'делайте скриншот только этой клавишей из игры. Снимки Windows, Steam, NVIDIA и других программ не подойдут — в них нет координат.',
  en: 'take the screenshot only with this key of the game. Screenshots of Windows, Steam, NVIDIA and other programs will not do: they have no coordinates.',
}
const OK: Phrase = { ru: 'Понятно', en: 'Got it' }
const TAB_ALT: Phrase = { ru: 'Настройки игры, вкладка «Управление»', en: 'The game’s settings, the Controls tab' }
const ROW_ALT: Phrase = { ru: 'Управление игры, строка «Сделать скриншот» и её клавиша', en: 'The game’s controls, the Take screenshot line and its key' }

/** «Управление» on the settings' tab row (assets/guide/game-settings-controls.webp, the owner's screenshot). */
const TAB_MARK: Mark = [76, 48, 16.5, 26]
/** «Сделать скриншот» and its key (assets/guide/game-settings-screenshot-key.webp, the owner's screenshot). */
const ROW_MARKS: Mark[] = [[2.4, 48.8, 22.7, 14, false], [49.1, 48.8, 10.9, 14, 'left']]

function GameShot({ src, alt, marks }: { src: string; alt: string; marks: Mark[] }) {
  return <figure className="skg-shot">
    <img src={src} alt={alt} draggable={false} />
    {marks.map(([left, top, width, height, arrow = 'down'], index) => {
      const box: CSSProperties = { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }
      return <span key={index} className="skg-mark" style={box} aria-hidden="true">
        {arrow && <span className={`skg-arrow is-${arrow}`}><ArrowDown size={20} strokeWidth={2.6} /></span>}
      </span>
    })}
  </figure>
}

/**
 * «Местоположение на карте» (owner, 13.11.2026): a new player's first start of the PC app, after «Показать возможности
 * Raid OS?» whatever the answer — how to set the game's screenshot key, the screenshots marked by the app's own pointers
 * in place of the owner's red circles, and that only the game's own key will do (its screenshots carry the coordinates).
 * When it is due: src/onboarding/tours.ts screenshotKeyDue; shown by FeatureTours, one window at a time.
 */
export function ScreenshotKeyGuide({ onDone }: { onDone: () => void }) {
  const { locale } = useLocale()
  const say = (phrase: Phrase) => phrase[locale === 'en' ? 'en' : 'ru']
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => { button.current?.focus({ preventScroll: true }) }, [])
  return createPortal(
    <div className="frg-layer" onKeyDown={(event) => { if (event.key === 'Escape') onDone() }}>
      <div className="frg-dim" />
      <div className="frg-card is-placed is-center skg-card" role="dialog" aria-modal="true" aria-labelledby="skg-title" aria-describedby="skg-why">
        <div className="frg-eyebrow"><MapPin size={13} aria-hidden="true" /> {say(EYEBROW)}</div>
        <h2 id="skg-title">{say(TITLE)}</h2>
        <p id="skg-why">{say(WHY)}</p>
        <ol className="skg-steps">
          <li><span className="skg-num">1</span><div><span>{say(STEP_TAB)}</span><GameShot src={controlsTab} alt={say(TAB_ALT)} marks={[TAB_MARK]} /></div></li>
          <li><span className="skg-num">2</span><div><span>{say(STEP_ROW)}</span><GameShot src={screenshotRow} alt={say(ROW_ALT)} marks={ROW_MARKS} /></div></li>
          <li><span className="skg-num">3</span><div><span>{say(STEP_RAID)}</span></div></li>
        </ol>
        <div className="skg-warn" role="note"><TriangleAlert size={18} aria-hidden="true" /><span><strong>{say(MAIN)}</strong> {say(WARN)}</span></div>
        <button ref={button} type="button" className="button primary frg-accept" onClick={onDone}>{say(OK)}</button>
      </div>
    </div>,
    document.body,
  )
}
