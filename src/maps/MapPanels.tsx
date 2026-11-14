import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Columns3, Eye, EyeOff, Rows3, Settings } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import './mapPanels.css'

/**
 * The PC map's two panels, the locations and points on the left and the quests on the right (report 158, owner 14.11.2026:
 * «если у человека монитор 9х16… сделай наверху кнопку настроек… блоки расположить… вертикально, либо горизонтально… кнопка
 * глаза, при нажатии он будет перечеркиваться… когда блок исчез, эта кнопка остается на месте, но она остается прозрачной»).
 * Kept on this device. Until a layout is chosen, a window taller than wide gets the panels above and below the map.
 */
export type MapPanelsLayout = 'side' | 'stacked'
export type MapPanelSide = 'left' | 'right'

interface StoredPanels { layout?: MapPanelsLayout; hidden: MapPanelSide[] }

const KEY = 'raidos-map-panels-v1'
const EVENT = 'raidos-map-panels-changed'
const NOTHING: StoredPanels = { hidden: [] }
let cache: { raw: string | null; panels: StoredPanels } | undefined

function parse(raw: string | null): StoredPanels {
  if (!raw) return NOTHING
  try {
    const stored = JSON.parse(raw) as Partial<StoredPanels> | null
    if (!stored || typeof stored !== 'object') return NOTHING
    const layout = stored.layout === 'side' || stored.layout === 'stacked' ? stored.layout : undefined
    const hidden = Array.isArray(stored.hidden) ? stored.hidden.filter((side): side is MapPanelSide => side === 'left' || side === 'right') : []
    return { ...(layout ? { layout } : {}), hidden }
  } catch {
    return NOTHING
  }
}

export function readMapPanels(): StoredPanels {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { /* storage unavailable */ }
  if (cache && cache.raw === raw) return cache.panels
  cache = { raw, panels: parse(raw) }
  return cache.panels
}

function write(next: StoredPanels) {
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export function setMapPanelsLayout(layout: MapPanelsLayout) {
  write({ ...readMapPanels(), layout })
}

export function setMapPanelHidden(side: MapPanelSide, hidden: boolean) {
  const current = readMapPanels()
  const rest = current.hidden.filter((entry) => entry !== side)
  write({ ...current, hidden: hidden ? [...rest, side] : rest })
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

const PORTRAIT = '(orientation: portrait)'
function subscribePortrait(listener: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(PORTRAIT)
  query.addEventListener?.('change', listener)
  return () => query.removeEventListener?.('change', listener)
}
const readPortrait = () => typeof window.matchMedia === 'function' && window.matchMedia(PORTRAIT).matches

export function useMapPanels() {
  const stored = useSyncExternalStore(subscribe, readMapPanels, () => NOTHING)
  const portrait = useSyncExternalStore(subscribePortrait, readPortrait, () => false)
  const layout: MapPanelsLayout = stored.layout ?? (portrait ? 'stacked' : 'side')
  return { layout, leftHidden: stored.hidden.includes('left'), rightHidden: stored.hidden.includes('right') }
}

/** The eye: a crossed eye while the panel is hidden, and the button stays where it was, faint. */
export function MapPanelEye({ side, hidden }: { side: MapPanelSide; hidden: boolean }) {
  const label = uiText(hidden ? 'Показать панель' : 'Скрыть панель')
  return <button type="button" className={`map-panel-button map-panel-eye${hidden ? ' is-off' : ''}`} data-side={side} aria-pressed={hidden} aria-label={label} title={label}
    onClick={() => setMapPanelHidden(side, !hidden)}>
    {hidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
  </button>
}

const LAYOUTS: Array<[MapPanelsLayout, string, ReactNode]> = [
  ['side', 'Слева и справа', <Columns3 key="side" size={15} aria-hidden="true" />],
  ['stacked', 'Сверху и снизу', <Rows3 key="stacked" size={15} aria-hidden="true" />],
]

/** The gear over the locations: where the two panels stand around the map. */
export function MapPanelsSettings({ layout }: { layout: MapPanelsLayout }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    document.addEventListener('pointerdown', onDown)
    // capture: the menu closes first, the map's own Esc (leaving the whole window) sees it handled
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, close])
  const label = uiText('Расположение панелей')
  return <div className="map-panels-settings" ref={rootRef}>
    <button type="button" className={`map-panel-button${open ? ' is-open' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}>
      <Settings size={15} aria-hidden="true" />
    </button>
    {open && <div className="map-panels-menu" role="menu" aria-label={label}>
      <div className="map-panels-menu-title">{label}</div>
      {LAYOUTS.map(([id, text, icon]) => (
        <button key={id} type="button" role="menuitemradio" aria-checked={layout === id} className={layout === id ? 'active' : ''}
          onClick={() => { setMapPanelsLayout(id); close() }}>
          {icon}{uiText(text)}
        </button>
      ))}
    </div>}
  </div>
}
