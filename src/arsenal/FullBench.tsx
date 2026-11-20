import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Minimize2 } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { isMobileLayout } from '../platform'
import { STATS_WINDOW_MOVED } from './BuildStage'
import { useBenchBackdrop } from './benchBackdrop'
import { signed } from './gunFormat'
import type { BuildStats } from './buildStats'
import type { Weapon } from './gunTypes'
import '../styles/weaponBuilds.css'

/**
 * The build over the whole screen and its stats window, for «Сборка оружия» and the Gunsmith task's bench (owner, 20.11.2026:
 * «Здесь нужно сделать кнопку «Открыть во весь экран», сложить приклад»).
 */

/** A stat's change against the stock build, green when it is better. */
export function Delta({ value, better, digits = 0, unit = '' }: { value: number; better: 'lower' | 'higher'; digits?: number; unit?: string }) {
  if (Math.abs(value) < 10 ** -(digits + 1)) return null
  const good = better === 'lower' ? value < 0 : value > 0
  return <span className={`wb-delta ${good ? 'is-good' : 'is-bad'}`}>{signed(value, digits)}{unit}</span>
}

const STATS_WINDOW_KEY = 'raidos-wb-stats-window'
function readStatsWindow(): { x: number; y: number } | null {
  try {
    const value = JSON.parse(localStorage.getItem(STATS_WINDOW_KEY) ?? 'null') as { x?: unknown; y?: unknown } | null
    return value && typeof value.x === 'number' && typeof value.y === 'number' ? { x: value.x, y: value.y } : null
  } catch { return null }
}

/**
 * The full screen (owner, 20.11.2026: «кнопку «Открыть на весь экран»… подобную Таркову»): the build over the whole window, the
 * chosen cell's modules at the side, the stats in a window that can be dragged where it suits. Esc: the chosen cell first, then back.
 */
export function FullBench({ weapon, stats, stock, selected, onSelect, onClose, children }: {
  weapon: Weapon; stats: BuildStats; stock: BuildStats; selected: string | null; onSelect: (key: string | null) => void
  onClose: () => void; children: (maxHeight: number) => ReactNode
}) {
  const stageBox = useRef<HTMLDivElement>(null)
  const docked = isMobileLayout()
  // the theme's picture behind the whole screen, not a framed part of it (owner, 20.11.2026: «фон на весь экран… не должно быть
  // часть зеленая, часть с нашим фоном»)
  const backdrop = useBenchBackdrop()
  const [room, setRoom] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight - 80))
  useLayoutEffect(() => {
    const element = stageBox.current
    if (!element) return
    const measure = () => setRoom(Math.max(200, element.clientHeight - 16))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (selected) onSelect(null)
      else onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [selected, onSelect, onClose])
  useEffect(() => {
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = before }
  }, [])
  // The PC: the window itself on the whole screen too (no taskbar, no title bar); leaving it (Esc) leaves the full screen.
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    if (docked || typeof document === 'undefined' || !document.documentElement.requestFullscreen) return
    let entered = false
    // Esc stays the page's (a module window closes first, then the full screen); the browser leaves on a long Esc
    const keyboard = (navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void } }).keyboard
    document.documentElement.requestFullscreen().then(() => { entered = true; return keyboard?.lock?.(['Escape']) }).catch(() => { /* the overlay alone is the full screen */ })
    const change = () => { if (entered && !document.fullscreenElement) close.current() }
    document.addEventListener('fullscreenchange', change)
    return () => {
      document.removeEventListener('fullscreenchange', change)
      keyboard?.unlock?.()
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [docked])
  return createPortal(<div className={`wb-full${backdrop ? ' has-backdrop' : ''}`} role="dialog" aria-modal="true" aria-label={`${uiText('Сборка на весь экран')}: ${weapon.name}`}>
    {backdrop && <><div className="wb-full-backdrop" style={{ backgroundImage: `url("${backdrop}")` }} aria-hidden="true" /><div className="wb-full-vignette" aria-hidden="true" /></>}
    {/* Only the build and one way out (owner, 20.11.2026: «скроет все кнопки и останется только сборка оружия… с выходом… кнопка») */}
    <button type="button" className="wb-full-exit" onClick={onClose} title={uiText('Выйти из полноэкранного режима (Esc)')} aria-label={uiText('Выйти из полноэкранного режима (Esc)')}><Minimize2 size={15} /><span>{uiText('Свернуть')}</span></button>
    <div className="wb-full-body">
      <div className="wb-full-stage">
        {/* A phone: the stats at the top left above the weapon (owner, 20.11.2026: «характеристики сверху… слева сверху») */}
        <div className="wb-full-stage-room" ref={stageBox}>{children(room)}</div>
      </div>
    </div>
    <StatsWindow stats={stats} stock={stock} compact={docked} />
  </div>, document.body)
}

/**
 * The build's stats in a small window over the full screen, held anywhere and dragged where it suits, on a PC and a phone; it stays
 * where it was left, and the module cells lay round it (src/arsenal/BuildStage.tsx). `compact` (a phone): narrower, without the deltas.
 */
function StatsWindow({ stats, stock, compact }: { stats: BuildStats; stock: BuildStats; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  // a phone starts below the top's buttons, a PC at the top left
  const [at, setAt] = useState(() => readStatsWindow() ?? { x: 12, y: compact ? 52 : 16 })
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const clamp = useCallback((x: number, y: number) => {
    const element = box.current
    const width = element?.offsetWidth ?? 220
    const height = element?.offsetHeight ?? 160
    return { x: Math.round(Math.max(0, Math.min(window.innerWidth - width, x))), y: Math.round(Math.max(0, Math.min(window.innerHeight - height, y))) }
  }, [])
  // a window left outside a smaller screen comes back inside
  useEffect(() => {
    const fit = () => setAt((current) => clamp(current.x, current.y))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [clamp])
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { dx: event.clientX - at.x, dy: event.clientY - at.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: ReactPointerEvent<HTMLDivElement>) => { if (drag.current) setAt(clamp(event.clientX - drag.current.dx, event.clientY - drag.current.dy)) }
  // the module cells lay round the window wherever it is (src/arsenal/BuildStage.tsx)
  useLayoutEffect(() => { window.dispatchEvent(new Event(STATS_WINDOW_MOVED)) }, [at])
  const up = () => {
    if (!drag.current) return
    drag.current = null
    try { localStorage.setItem(STATS_WINDOW_KEY, JSON.stringify(at)) } catch { /* the place is a convenience */ }
  }
  const ergoDelta = stats.ergonomicsRaw - stock.ergonomicsRaw
  const rows: Array<{ label: string; value: string; delta: number; better: 'lower' | 'higher'; digits?: number }> = [
    { label: 'Эргономика', value: String(stats.ergonomics), delta: ergoDelta, better: 'higher', digits: Math.round(Math.abs(ergoDelta) * 10) % 10 ? 1 : 0 },
    { label: 'Вес', value: `${stats.weightLoaded.toFixed(2)} ${uiText('кг')}`, delta: stats.weightLoaded - stock.weightLoaded, better: 'lower', digits: 2 },
    { label: 'Верт. отдача', value: String(stats.recoilVertical), delta: stats.recoilVertical - stock.recoilVertical, better: 'lower' },
    { label: 'Гориз. отдача', value: String(stats.recoilHorizontal), delta: stats.recoilHorizontal - stock.recoilHorizontal, better: 'lower' },
    { label: 'Скорость пули', value: stats.velocity ? `${Math.round(stats.velocity)} ${uiText('м/с')}` : '—', delta: (stats.velocity ?? 0) - (stock.velocity ?? 0), better: 'higher' },
  ]
  // held anywhere and moved, on a PC and a phone (owner, 20.11.2026: «блок характеристик можно было зажать и перемещать»)
  return <div className={`wb-stats-window is-handle${compact ? ' is-compact' : ''}`} ref={box} style={{ left: at.x, top: at.y }}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title={uiText('Перетащите окно, куда удобно')}>
    <div className="wb-stats-window-title">{uiText('Характеристики')}</div>
    {rows.map((row) => <div className="wb-stats-window-row" key={row.label}>
      <span>{uiText(row.label)}</span>
      <strong>{row.value}</strong>
      <Delta value={row.delta} better={row.better} digits={row.digits} />
    </div>)}
  </div>
}
