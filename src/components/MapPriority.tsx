import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import type { GameMap } from '../domain/types'

interface MapPriorityProps {
  maps: GameMap[]
  /** Current-stage tasks on this map. */
  countFor: (mapId: string) => number
  onOpen: (mapId: string) => void
  /** How many maps to show; all by default. */
  limit?: number
}

/**
 * The wheel scrolls the tile row sideways while the pointer is over it and there is more to see in that direction;
 * at either end the page scrolls as usual. React's onWheel is passive, so the listener is attached by hand.
 */
function useWheelScrollsSideways<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const row = ref.current
    if (!row) return
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      const max = row.scrollWidth - row.clientWidth
      if (max <= 1) return
      const step = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? row.clientWidth : 1)
      if ((step < 0 && row.scrollLeft <= 0) || (step > 0 && row.scrollLeft >= max - 1)) return
      event.preventDefault()
      row.scrollLeft += step
    }
    row.addEventListener('wheel', onWheel, { passive: false })
    return () => row.removeEventListener('wheel', onWheel)
  }, [])
  return ref
}

/**
 * "Приоритет карт": one thin strip across the Overview under the stat cards — title, the maps by current tasks as
 * one-line tiles (rank · map · count) over a thin bar, «Все карты». Tiles stretch to fill the row; when they do not fit, the row scrolls sideways
 * (wheel over it, drag on a touchpad, or the thin scrollbar).
 */
export function MapPriority({ maps, countFor, onOpen, limit }: MapPriorityProps) {
  const { locale } = useLocale()
  const rowRef = useWheelScrollsSideways<HTMLDivElement>()
  const rows = maps.map((map) => ({ map, count: countFor(map.id) })).sort((a, b) => b.count - a.count).slice(0, limit ?? maps.length)
  const max = Math.max(1, ...rows.map((row) => row.count))
  const taskLabel = (count: number) => {
    if (locale === 'en') return `${count} ${count === 1 ? 'task' : 'tasks'}`
    const lastTwo = count % 100
    const last = count % 10
    const word = lastTwo >= 11 && lastTwo <= 14 ? 'заданий' : last === 1 ? 'задание' : last >= 2 && last <= 4 ? 'задания' : 'заданий'
    return `${count} ${word}`
  }

  return <section className="panel map-priority" aria-label={uiText('Приоритет карт')}>
    <div className="panel-title map-priority-title">{uiText('Приоритет карт')}</div>
    <div className="map-priority-grid" ref={rowRef}>
      {rows.map(({ map, count }, index) => {
        const label = `${uiText(map.name)} · ${taskLabel(count)}`
        return <button type="button" key={map.id} className={`map-priority-tile ${index === 0 && count > 0 ? 'is-top' : ''} ${count === 0 ? 'is-empty' : ''}`} title={label} aria-label={label} onClick={() => onOpen(map.id)}>
          <span className="map-priority-rank mono">{String(index + 1).padStart(2, '0')}</span>
          <strong className="map-priority-name"><span className="map-priority-dot" style={{ background: map.accent }} aria-hidden="true" /><span className="map-priority-label">{uiText(map.name)}</span></strong>
          <span className="map-priority-count">{count}</span>
          <span className="map-priority-bar" aria-hidden="true"><span style={{ width: `${count / max * 100}%` }} /></span>
        </button>
      })}
    </div>
    <Link to="/maps" className="dim map-priority-all">{uiText('Все карты ')}<ChevronRight size={13} /></Link>
  </section>
}
