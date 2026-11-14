import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, SunMoon } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { DAY_NIGHT_THEME, THEMES, THEME_CHANGED_EVENT, saveAppearance } from './theme'
import './themeSchemeMenu.css'

/** «Смена дня и ночи» was turned on once on this device: its window is not shown again. */
const INTRO_KEY = 'raidos-daynight-intro-seen'
const MARGIN = 8

function introSeen() {
  try { return localStorage.getItem(INTRO_KEY) === '1' } catch { return true }
}
function markIntroSeen() {
  try { localStorage.setItem(INTRO_KEY, '1') } catch { /* storage unavailable */ }
}

/**
 * The right click on the top bar's scheme button (owner, 15.11.2026: «правой кнопкой нажимаем на цветовые схемы, там будут
 * обычные схемы и ниже надпись смена дня и ночи»): the ordinary schemes, and under them «Смена дня и ночи». The first time that
 * one is turned on, a window says what it does («появляется окно… только единоразово при первом включении»).
 */
export function ThemeSchemeMenu({ x, y, current, onPick, onClose }: { x: number; y: number; current: string; onPick: (id: string) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const size = box.current?.getBoundingClientRect()
    if (!size) return
    setPlace({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - size.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - size.height - MARGIN)),
    })
  }, [x, y])
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) onClose() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  const item = (id: string, label: string, icon: React.ReactNode) => <button key={id} type="button" role="menuitemradio" aria-checked={current === id} className={current === id ? 'is-active' : undefined} onClick={() => onPick(id)}>
    {icon}<span>{uiText(label)}</span>{current === id && <Check size={14} className="theme-scheme-check" aria-hidden="true" />}
  </button>
  return createPortal(<div ref={box} className="theme-scheme-menu" role="menu" aria-label={uiText('Цветовая схема')} style={place ?? { left: x, top: y, visibility: 'hidden' }} onContextMenu={(event) => event.preventDefault()}>
    {THEMES.map((theme) => item(theme.id, theme.label, <span className="theme-scheme-swatch" aria-hidden="true" style={{ background: `linear-gradient(135deg, ${theme.swatch[0]} 0 45%, ${theme.swatch[1]} 45% 75%, ${theme.swatch[2]} 75%)` }} />))}
    <div className="theme-scheme-divider" role="separator" />
    {item(DAY_NIGHT_THEME.id, DAY_NIGHT_THEME.label, <SunMoon size={16} className="theme-scheme-icon" aria-hidden="true" />)}
  </div>, document.body)
}

/** The window shown once, the first time «Смена дня и ночи» is turned on. */
export function DayNightIntro({ onClose }: { onClose: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    button.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(<div className="registration-overlay daynight-intro-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="panel registration-dialog daynight-intro" role="dialog" aria-modal="true" aria-labelledby="daynight-intro-title">
      <SunMoon size={34} className="daynight-intro-icon" aria-hidden="true" />
      <h2 id="daynight-intro-title">{uiText('Смена дня и ночи')}</h2>
      <p>{uiText('Цветовая схема меняется в зависимости от вашего времени суток.')}</p>
      <button ref={button} type="button" className="button primary" onClick={onClose}>{uiText('Понятно')}</button>
    </section>
  </div>, document.body)
}

/** The scheme button's right click: the menu, the scheme picked from it, and the one-time window for «Смена дня и ночи». */
export function useThemeSchemeMenu(current: string, onChanged: (id: string) => void) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [intro, setIntro] = useState(false)
  const pick = (id: string) => {
    setMenu(null)
    if (id !== current) {
      saveAppearance(id)
      window.dispatchEvent(new Event(THEME_CHANGED_EVENT))
      onChanged(id)
    }
    if (id === DAY_NIGHT_THEME.id && !introSeen()) {
      markIntroSeen()
      setIntro(true)
    }
  }
  const onContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY })
  }
  const overlay = <>
    {menu && <ThemeSchemeMenu x={menu.x} y={menu.y} current={current} onPick={pick} onClose={() => setMenu(null)} />}
    {intro && <DayNightIntro onClose={() => setIntro(false)} />}
  </>
  return { onContextMenu, overlay }
}
